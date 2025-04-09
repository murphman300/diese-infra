import { EC2Resources } from "./configuration";
import { EcsClusterResources } from "../webapp/index";
import { DatabaseResources } from "../databases/index";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
let config = new pulumi.Config();

export interface EC2InstancesResources {
    bastionInstance: aws.ec2.Instance;
    securityGroup: aws.ec2.SecurityGroup;
}

export function createEC2Instances(env: string, resources: EC2Resources, cluster: EcsClusterResources, databases: DatabaseResources) : EC2InstancesResources {
    const bastionName = `${env}-ec2-bastion-host`;

    const bastionAmiId = config.require("ec2_ami_id");
    const bastionInstanceType = config.require("ec2_bastion_instance_type");
    const region = aws.config.region || "us-east-1";

    // Create a user data script to ensure SSM agent is properly configured
    const userData = pulumi.interpolate`#!/bin/bash
# Set NODE_ENV environment variable
echo "NODE_ENV=${env}" >> /home/ec2-user/.bashrc
echo "REGION=${region}" >> /home/ec2-user/.bashrc
source /home/ec2-user/.bashrc
`;

    const bastionInstance = new aws.ec2.Instance(bastionName, {
        ami: bastionAmiId,
        iamInstanceProfile: resources.instanceProfile.name,
        instanceType: bastionInstanceType,
        vpcSecurityGroupIds: [resources.securityGroup.id],
        subnetId: cluster.computeSubnets[0].id, 
        // keyName: resources.bastionKeyPair.keyName,
        userData: userData,
        associatePublicIpAddress: true,
        tags: {
            Name: bastionName,
            Environment: env,
            ManagedBy: "pulumi"
        },
    });

    return {
        bastionInstance,
        securityGroup: resources.securityGroup,
    }
}