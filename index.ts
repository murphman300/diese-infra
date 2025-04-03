import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import createIAMResources from "./iam/index";

let config = new pulumi.Config();
let env = config.require("env");

// Create IAM resources
const iamResources = createIAMResources(env);
