import * as pulumi from "@pulumi/pulumi";
import createIAMResources from "./iam/index";
import createCertificates from "./certificates/index";
import createContainerRegistry, { createMigrationsContainerRegistry } from "./container-registry/index";
import createDatabases from "./databases/index";
import { createEcsCluster } from "./webapp/index";
import { createEC2 } from "./ec2/index";
import { declareS3Buckets } from "./s3/index";
import { createSecrets } from "./secrets/index";
let config = new pulumi.Config();
let env = config.require("env");

// Create IAM resources
const iamResources = createIAMResources(env);

const secrets = createSecrets(env);

// Create certificates
const certificates = createCertificates(env);

// Create container registry
const containerRegistry = createContainerRegistry(env);

const migrationsContainerRegistry = createMigrationsContainerRegistry(env);

// Create databases
const databases = createDatabases(env);

// Create ECS cluster and related resources (including ALB)
const webapp = createEcsCluster(env, containerRegistry.repository, databases, migrationsContainerRegistry.repository, certificates);

const ec2 = createEC2(env, webapp, databases);
// Create S3 buckets
const s3Buckets = declareS3Buckets(env, ec2, iamResources.githubRunner, webapp.s3VpcEndpoint);

// Export necessary values
export const albDnsName = webapp.webappLoadBalancer.dnsName;
export const albZoneId = webapp.webappLoadBalancer.zoneId;
export const targetGroupArn = webapp.webappTargetGroup.arn;
export const ecsServiceArn = webapp.autoScalingResources?.service.id;
// export const bastionHostIp = ec2.instances.bastionInstance.publicIp;
export const appsBucketName = s3Buckets;