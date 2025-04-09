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
    ssmVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    ec2MessagesVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    ssmmessagesVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    // bastionKeyPairSecret: aws.secretsmanager.Secret;
}

export function createEC2Resources(
    name: string,
    env: string,
    cluster: EcsClusterResources,
    opts?: pulumi.CustomResourceOptions
): EC2Resources {
    const config = new pulumi.Config();
    const region = aws.config.region || "us-east-1"; // Determine region

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
    // const s3Policy = new aws.iam.RolePolicy(`${name}-s3-policy`, {
    //     role: instanceRole.id,
    //     policy: JSON.stringify({
    //         Version: "2012-10-17",
    //         Statement: [{
    //             Effect: "Allow",
    //             Action: [
    //                 "s3:GetObject",
    //                 "s3:ListBucket",
    //                 "s3:GetBucketLocation"
    //             ],
    //             Resource: [
    //                 "arn:aws:s3:::*",
    //                 "arn:aws:s3:::*/*"
    //             ]
    //         }]
    //     })
    // }, opts);

    

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

    // Attach the SSM Managed Instance Core policy to allow SSM management
    const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment(`${name}-ssm-policy-attachment`, {
        role: instanceRole.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    }, opts);
    
    // Attach additional SSM policies
    const ssmFullAccessPolicyAttachment = new aws.iam.RolePolicyAttachment(`${name}-ssm-full-access-attachment`, {
        role: instanceRole.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonSSMFullAccess"
    }, opts);
    
    // Create custom policy for additional SSM permissions
    const additionalSsmPolicy = new aws.iam.RolePolicy(`${name}-additional-ssm-policy`, {
        role: instanceRole.id,
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "ssm:DescribeInstanceInformation",
                    "ssm:GetConnectionStatus",
                    "ssm:GetParameter",
                    "ssm:GetParameters",
                    "ssm:ListInstanceAssociations",
                    "ssm:ListTagsForResource",
                    "ssm:DescribeDocument"
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
    // const bastionKeyPairSecret = new aws.secretsmanager.Secret(`${name}-ec2-bastion-keypair-secret`, {
    //     name: `${name}-bastion-keypair`,
    //     description: "Secret containing EC2 bastion host keypair",
    //     tags: {
    //         Name: `${name}-bastion-keypair`,
    //         Environment: env,
    //         ManagedBy: "pulumi"
    //     }
    // }, opts);

    // Create security group in the compute VPC
    const securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
        description: "Security group for EC2 instances",
        vpcId: cluster.ecsSecurityGroup.vpcId,
        ingress: [
            {
                description: "SSH access from allowed IP range",
                fromPort: 22,
                toPort: 22,
                protocol: "tcp",
                cidrBlocks: [config.require("ssh_allowed_ip_range") + "/32"]
            },
            {
                description: "HTTPS access for SSM",
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"]
            }
        ],
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


    // IMPORTANT OR THE BASTION WONT BE DISCOVERED BY SSM
    const vpcEndpointSecurityGroupIngressRule = new aws.ec2.SecurityGroupRule(`${name}-vpc-endpoint-security-group-ingress`, {
        type: "ingress",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        securityGroupId: cluster.vpcEndpointSecurityGroup.id,
        sourceSecurityGroupId: securityGroup.id,
        description: "Allow the bastion host to access the SSM VPC endpoint"
    }, opts);
    

    // Create a dedicated security group for SSM VPC endpoints with VERY permissive rules for testing
    const ssmEndpointSecurityGroup = new aws.ec2.SecurityGroup(`${name}-ssm-endpoint-sg`, {
        description: "Security group for SSM VPC endpoints",
        vpcId: cluster.ecsSecurityGroup.vpcId,
        ingress: [
            {
                description: "HTTPS access from EC2 instances",
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                securityGroups: [securityGroup.id]
            },
            {
                description: "HTTPS access from anywhere for testing",
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                cidrBlocks: ["0.0.0.0/0"]
            }
        ],
        egress: [{
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            description: "Allow all outbound traffic"
        }],
        tags: {
            Name: `${name}-ssm-endpoint-sg`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    }, opts);

    // Add explicit rule to allow communication between the SSM endpoints and EC2 instances
    const ssmToEc2Rule = new aws.ec2.SecurityGroupRule(`${name}-ssm-to-ec2`, {
        type: "egress",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        securityGroupId: ssmEndpointSecurityGroup.id,
        sourceSecurityGroupId: securityGroup.id,
        description: "Allow SSM endpoints to communicate with EC2 instances"
    }, opts);
    
    // Add an explicit rule to allow the EC2 instance to access SSM endpoints
    const ec2ToSsmEndpointRule = new aws.ec2.SecurityGroupRule(`${name}-ec2-to-ssm-endpoint`, {
        type: "egress",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        securityGroupId: securityGroup.id,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow EC2 instance to access SSM endpoints"
    }, opts);

    // Create VPC Endpoint for SSM
    const ssmServiceName = `com.amazonaws.${region}.ssm`;
    const ssmVpcEndpoint = pulumi.all([
        cluster.ecsSecurityGroup.vpcId,
        cluster.computeSubnets.map(subnet => subnet.id),
        ssmEndpointSecurityGroup.id
    ]).apply(([vpcId, subnetIds, endpointSecurityGroupId]) => {
        if (!subnetIds || subnetIds.length === 0) {
            pulumi.log.warn("Subnet IDs for SSM VPC Endpoint are missing or empty from cluster object. Endpoint creation might fail or be incomplete. Ensure 'computeSubnetIds' is returned by EcsClusterResources.");
        }

        // First, try to check if an SSM endpoint already exists in this VPC
        return new aws.ec2.VpcEndpoint(`${env}-${name}-ssm-vpc-endpoint`, {
            vpcId: vpcId,
            serviceName: ssmServiceName,
            vpcEndpointType: "Interface",
            subnetIds: subnetIds,
            securityGroupIds: [endpointSecurityGroupId, securityGroup.id], // Add EC2 security group for testing
            privateDnsEnabled: false,
            tags: {
                Name: `${env}-${name}-ssm-vpc-endpoint`,
                Environment: env,
                ManagedBy: "pulumi"
            }
        }, {
            ignoreChanges: ["privateDnsEnabled", "securityGroupIds"], // Ignore changes to privateDnsEnabled to prevent conflicts
        });
    });

    // Create VPC Endpoint for EC2 Messages (required for SSM)
    const ec2MessagesServiceName = `com.amazonaws.${region}.ec2messages`;
    const ec2MessagesVpcEndpoint = pulumi.all([
        cluster.ecsSecurityGroup.vpcId,
        cluster.computeSubnets.map(subnet => subnet.id),
        ssmEndpointSecurityGroup.id
    ]).apply(([vpcId, subnetIds, endpointSecurityGroupId]) => {
        return new aws.ec2.VpcEndpoint(`${env}-${name}-ec2messages-vpc-endpoint`, {
            vpcId: vpcId,
            serviceName: ec2MessagesServiceName,
            vpcEndpointType: "Interface",
            subnetIds: subnetIds,
            securityGroupIds: [endpointSecurityGroupId, securityGroup.id], // Add EC2 security group for testing
            privateDnsEnabled: false, // Set to false to avoid conflicts with existing endpoints
            tags: {
                Name: `${env}-${name}-ec2messages-vpc-endpoint`,
                Environment: env,
                ManagedBy: "pulumi"
            }
        }, {
            ignoreChanges: ["privateDnsEnabled", "securityGroupIds"], // Ignore changes to privateDnsEnabled to prevent conflicts
        });
    });

    // Create VPC Endpoint for SSM Messages (required for Session Manager)
    const ssmmessagesServiceName = `com.amazonaws.${region}.ssmmessages`;
    const ssmmessagesVpcEndpoint = pulumi.all([
        cluster.ecsSecurityGroup.vpcId,
        cluster.computeSubnets.map(subnet => subnet.id),
        ssmEndpointSecurityGroup.id
    ]).apply(([vpcId, subnetIds, endpointSecurityGroupId]) => {
        return new aws.ec2.VpcEndpoint(`${env}-${name}-ssmmessages-vpc-endpoint`, {
            vpcId: vpcId,
            serviceName: ssmmessagesServiceName,
            vpcEndpointType: "Interface",
            subnetIds: subnetIds,
            securityGroupIds: [endpointSecurityGroupId, securityGroup.id], // Add EC2 security group for testing
            privateDnsEnabled: false, // Set to false to avoid conflicts with existing endpoints
            tags: {
                Name: `${env}-${name}-ssmmessages-vpc-endpoint`,
                Environment: env,
                ManagedBy: "pulumi"
            }
        }, {
            ignoreChanges: ["privateDnsEnabled", "securityGroupIds"], // Ignore changes to privateDnsEnabled to prevent conflicts
        });
    });

    return {
        instanceRole,
        instanceProfile,
        securityGroup,
        bastionKeyPair,
        ssmVpcEndpoint,
        ec2MessagesVpcEndpoint,
        ssmmessagesVpcEndpoint
    };
}