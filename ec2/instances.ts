import { EC2Resources } from "./configuration";
import { EcsClusterResources } from "../webapp/index";
import { DatabaseResources } from "../databases/index";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
let config = new pulumi.Config();

export interface EC2InstancesResources {
    // bastionInstance: aws.ec2.Instance;
}

export function createEC2Instances(env: string, resources: EC2Resources, cluster: EcsClusterResources, databases: DatabaseResources) : EC2InstancesResources {
    const bastionName = `${env}-ec2-bastion-host`;

    const bastionAmiId = config.require("ec2_ami_id");
    const bastionInstanceType = config.require("ec2_bastion_instance_type");

    

    // const bastionKeyName = config.require("ec2_bastion_key_name");
    const bastionInstance = new aws.ec2.Instance(bastionName, {
        ami: bastionAmiId,
        iamInstanceProfile: resources.instanceProfile.name,
        instanceType: bastionInstanceType,
        vpcSecurityGroupIds: [resources.securityGroup.id],
        subnetId: cluster.computeSubnets[0].id, 
        // keyName: resources.bastionKeyPair.keyName,
        tags: {
            Name: bastionName,
            Environment: env,
            ManagedBy: "pulumi"
        },
    });

    return {
        // bastionInstance
    }
}