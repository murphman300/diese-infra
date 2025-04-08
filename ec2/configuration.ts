import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { EcsClusterResources } from "../webapp";

interface EC2ResourcesArgs {
    iamUserArn: string;
    allowedIpRange: string; // CIDR block for SSH access
}

export interface EC2Resources {
    instanceRole: aws.iam.Role;
    instanceProfile: aws.iam.InstanceProfile;
    securityGroup: aws.ec2.SecurityGroup;
    bastionKeyPair: aws.ec2.KeyPair;
    bastionKeyPairSecret: aws.secretsmanager.Secret;
}

export function createEC2Resources(
    name: string,
    env: string,
    cluster: EcsClusterResources,
    opts?: pulumi.CustomResourceOptions
): EC2Resources {
    const config = new pulumi.Config();

    // Create IAM role for EC2
    const instanceRole = new aws.iam.Role(`${name}-role`, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ec2.amazonaws.com"
                }
            }]
        })
    }, opts);

    // Create policy for S3 read access
    const s3Policy = new aws.iam.RolePolicy(`${name}-s3-policy`, {
        role: instanceRole.id,
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:GetBucketLocation"
                ],
                Resource: [
                    "arn:aws:s3:::*",
                    "arn:aws:s3:::*/*"
                ]
            }]
        })
    }, opts);

    // Create policy for Secrets Manager read access
    const secretsPolicy = new aws.iam.RolePolicy(`${name}-secrets-policy`, {
        role: instanceRole.id,
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:ListSecrets"
                ],
                Resource: "*"
            }]
        })
    }, opts);

    // Create policy for RDS access
    const rdsPolicy = new aws.iam.RolePolicy(`${name}-rds-policy`, {
        role: instanceRole.id,
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "rds-db:connect",
                    "rds:DescribeDBInstances",
                    "rds:ListTagsForResource"
                ],
                Resource: "*"
            }]
        })
    }, opts);

    // Create policy for Lambda access
    const lambdaPolicy = new aws.iam.RolePolicy(`${name}-lambda-policy`, {
        role: instanceRole.id,
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "lambda:InvokeFunction",
                    "lambda:ListFunctions"
                ],
                Resource: "*"
            }]
        })
    }, opts);

    // Create instance profile
    const instanceProfile = new aws.iam.InstanceProfile(`${name}-profile`, {
        role: instanceRole.name,
    }, opts);

    const pubKey = config.require("ec2_key_pair_pub");

    // Create EC2 key pair
    const bastionKeyPair = new aws.ec2.KeyPair(`${name}-ec2-bastion-keypair`, {
        keyName: `${name}-bastion-pub-key`,
        tags: {
            Name: `${name}-bastion-pub-key`,
            Environment: env,
            ManagedBy: "pulumi"
        },
        publicKey: pubKey,
    }, opts);

    // Create secret for EC2 key pair
    const bastionKeyPairSecret = new aws.secretsmanager.Secret(`${name}-ec2-bastion-keypair-secret`, {
        name: `${name}-bastion-keypair`,
        description: "Secret containing EC2 bastion host keypair",
        tags: {
            Name: `${name}-bastion-keypair`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    }, opts);

    // Create security group in the compute VPC
    const securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
        description: "Security group for EC2 instances",
        vpcId: cluster.ecsSecurityGroup.vpcId,
        ingress: [{
            description: "SSH access from allowed IP range",
            fromPort: 22,
            toPort: 22,
            protocol: "tcp",
            cidrBlocks: [config.require("ssh_allowed_ip_range") + "/32"]
        }],
        egress: [{
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
            description: "Allow all outbound traffic"
        }],
        tags: {
            Name: `${name}-sg`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    }, opts);

    return {
        instanceRole,
        instanceProfile,
        securityGroup,
        bastionKeyPair,
        bastionKeyPairSecret
    };
}