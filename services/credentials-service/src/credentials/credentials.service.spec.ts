import { HttpModule, HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { CredentialsService } from './credentials.service';
import Ajv2019 from 'ajv/dist/2019';
import { UnsignedVCValidator, VCValidator } from './types/validators/index';
import { SchemaUtilsSerivce } from './utils/schema.utils.service';
import { IdentityUtilsService } from './utils/identity.utils.service';
import { RenderingUtilsService } from './utils/rendering.utils.service';
import { PrismaClient } from '@prisma/client';
import {
  generateCredentialRequestPayload,
  generateCredentialSchemaTestBody,
  generateTestDIDBody,
  getCredentialByIdSchema,
  issueCredentialReturnTypeSchema,
} from './credentials.fixtures';
import { schemaHasRules } from 'ajv/dist/compile/util';

// setup ajv
const ajv = new Ajv2019({ strictTuples: false });
ajv.addFormat('custom-date-time', function (dateTimeString) {
  return typeof dateTimeString === typeof new Date();
});

describe('CredentialsService', () => {
  let service: CredentialsService;
  let httpSerivce: HttpService;
  let identityUtilsService: IdentityUtilsService;

  const validate = ajv.compile(issueCredentialReturnTypeSchema);
  const getCredReqValidate = ajv.compile(getCredentialByIdSchema);

  let issuerDID;
  let subjectDID;
  let credentialSchemaID;
  let sampleCredReqPayload;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        CredentialsService,
        PrismaClient,
        RenderingUtilsService,
        SchemaUtilsSerivce,
        IdentityUtilsService,
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);
    httpSerivce = module.get<HttpService>(HttpService);
    identityUtilsService =
      module.get<IdentityUtilsService>(IdentityUtilsService);

    issuerDID = await identityUtilsService.generateDID([
      'VerifiableCredentialTESTINGIssuer',
    ]);
    issuerDID = issuerDID[0].id;

    subjectDID = await identityUtilsService.generateDID([
      'VerifiableCredentialTESTINGIssuer',
    ]);
    subjectDID = subjectDID[0].id;

    const schemaPayload = generateCredentialSchemaTestBody();
    schemaPayload.schema.author = issuerDID;
    const schema = await httpSerivce.axiosRef.post(
      `${process.env.SCHEMA_BASE_URL}/credential-schema`,
      schemaPayload
    );
    credentialSchemaID = schema.data.schema.id;
    sampleCredReqPayload = generateCredentialRequestPayload(
      issuerDID,
      subjectDID,
      credentialSchemaID,
      schema.data.schema.version
    );
  });

  it('service should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should issue a credential', async () => {
    const newCred = await service.issueCredential(sampleCredReqPayload);
    VCValidator.parse(newCred.credential);
    expect(validate(newCred)).toBe(true);
  });

  it('should get a credential', async () => {
    const newCred: any = await service.issueCredential(sampleCredReqPayload);
    const cred = await service.getCredentialById(newCred.credential?.id);
    UnsignedVCValidator.parse(cred);
    expect(getCredReqValidate(cred)).toBe(true);
  });

  it('should throw because no credential is present to be searched by ID', async () => {
    await expect(service.getCredentialById('did:ulp:123')).rejects.toThrow();
  });

  it('should throw because credential not present to be verified', async () => {
    await expect(service.verifyCredential('did:ulp:123')).rejects.toThrow();
  });

  it('should say revoked', async () => {
    const newCred = await service.issueCredential(sampleCredReqPayload);
    expect(
      await service.deleteCredential((newCred.credential as any).id)
    ).toHaveProperty('status', 'REVOKED');
  });

  it('should throw while delete because credential not present', async () => {
    await expect(service.deleteCredential('did:ulp:123')).rejects.toThrow();
  });

  it('should throw', async () => {
    await expect(
      service.getCredentialsBySubjectOrIssuer({
        subject: { id: 'did:ulp:123' },
      })
    ).rejects.toThrow();
  });

  it('should return array of creds based on issuer', async () => {
    try {
      const newCred = await service.issueCredential(sampleCredReqPayload);
      expect(
        await service.getCredentialsBySubjectOrIssuer({
          issuer: {
            id: (newCred.credential as any)?.issuer,
          },
        })
      ).toBeInstanceOf(Array);
    } catch (e) {
      expect(e.message).toBe(
        'No credentials found for the given subject or issuer'
      );
    }
  });
});
