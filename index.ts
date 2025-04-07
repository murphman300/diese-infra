import * as pulumi from "@pulumi/pulumi";
import createIAMResources from "./iam/index";
import createCertificates from "./certificates/index";
import createContainerRegistry from "./container-registry/index";
import createDatabases from "./databases/index";
import { createEcsCluster } from "./webapp/index";

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

// Create ECS cluster and related resources (including ALB)
const webapp = createEcsCluster(env, containerRegistry.repository, databases, certificates);

// Export necessary values
export const albDnsName = webapp.webappLoadBalancer.dnsName;
export const albZoneId = webapp.webappLoadBalancer.zoneId;
export const targetGroupArn = webapp.webappTargetGroup.arn;
export const ecsServiceArn = webapp.autoScalingResources?.service.id;