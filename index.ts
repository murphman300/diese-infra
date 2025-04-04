import * as pulumi from "@pulumi/pulumi";
import createIAMResources from "./iam/index";
import createCertificates from "./certificates/index";
import createContainerRegistry from "./container-registry/index";
import createDatabases from "./databases/index";
let config = new pulumi.Config();
let env = config.require("env");

// Create IAM resources
const iamResources = createIAMResources(env);

// Create certificates
const certificates = createCertificates(env);

// Create container registry
const containerRegistry = createContainerRegistry(env);

// Create databases
const databases = createDatabases(env);