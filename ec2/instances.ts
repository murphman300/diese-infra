import { EC2Resources } from "./configuration";
import { EcsClusterResources } from "../webapp/index";
import { DatabaseResources } from "../databases/index";
import * as aws from "@pulumi/aws";

export function createEC2Instances(env: string, resources: EC2Resources, cluster: EcsClusterResources, databases: DatabaseResources) {
    const bastionName = `${env}-ec2-bastion-host`;

    // const bastionInstance = new aws.ec2.Instance(bastionName, {
    //     ami: "ami-048d2b60a58148709", // ubuntu 22.04, TODO replace with a custom AMI
    //     instanceType: "t3.micro",
    //     vpcSecurityGroupIds: [resources.securityGroup.id],
    //     subnetId: databases.subnet1.id,
    //     keyName: resources.bastionKeyPair.keyName,
    //     tags: {
    //         Name: bastionName,
    //         Environment: env,
    //         ManagedBy: "pulumi"
    //     }
    // });

    return {
        // bastionInstance
    }
}