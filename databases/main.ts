import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export function createDatabase(env: string) {
    const config = new pulumi.Config();
    const dbResourceName = config.require("main_db_resource_name");
    const dbName = `${dbResourceName}`;
    const dbUsername = config.require("main_db_username");
    // Create VPC for RDS with more specific CIDR
    const vpc = new aws.ec2.Vpc(`${dbName}-vpc`, {
        cidrBlock: "10.0.0.0/16",
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: {
            Name: `${dbName}-vpc`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create an Internet Gateway
    const internetGateway = new aws.ec2.InternetGateway(`${dbName}-igw`, {
        vpcId: vpc.id,
        tags: {
            Name: `${dbName}-igw`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create route table for public subnets
    const routeTable = new aws.ec2.RouteTable(`${env}-${dbName}-rt`, {
        vpcId: vpc.id,
        routes: [{
            cidrBlock: "0.0.0.0/0",
            gatewayId: internetGateway.id,
        }],
        tags: {
            Name: `${dbName}-rt`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create private subnets in different AZs
    const subnet1 = new aws.ec2.Subnet(`${env}-${dbName}-subnet-1`, {
        vpcId: vpc.id,
        cidrBlock: "10.0.1.0/24",
        availabilityZone: "ca-central-1a",
        mapPublicIpOnLaunch: false,
        tags: {
            Name: `${dbName}-subnet-1`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    const subnet2 = new aws.ec2.Subnet(`${env}-${dbName}-subnet-2`, {
        vpcId: vpc.id,
        cidrBlock: "10.0.2.0/24",
        availabilityZone: "ca-central-1b",
        mapPublicIpOnLaunch: false,
        tags: {
            Name: `${dbName}-subnet-2`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create subnet group
    const subnetGroup = new aws.rds.SubnetGroup(`${env}-${dbName}-subnet-group`, {
        subnetIds: [subnet1.id, subnet2.id],
        tags: {
            Name: `${dbName}-subnet-group`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create security group with stricter rules
    const securityGroup = new aws.ec2.SecurityGroup(`${env}-${dbName}-security-group`, {
        vpcId: vpc.id,
        description: "Security group for RDS PostgreSQL instance",
        ingress: [{
            protocol: "tcp",
            fromPort: 5432,
            toPort: 5432,
            // In production, this should be your application's security group or VPC CIDR
            cidrBlocks: [vpc.cidrBlock],
            description: "PostgreSQL access from within VPC"
        }],
        egress: [{
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [vpc.cidrBlock],
            description: "Allow all outbound traffic"
        }],
        tags: {
            Name: `${dbName}-security-group`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create a KMS key for encryption
    const kmsKey = new aws.kms.Key(`${env}-${dbName}-kms-key`, {
        description: "KMS key for RDS encryption",
        enableKeyRotation: true,
        tags: {
            Name: `${dbName}-kms-key`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create a secret in AWS Secrets Manager
    const dbSecretName = `${env}/${dbResourceName}/credentials-1`;
    const dbSecret = new aws.secretsmanager.Secret(`${env}-${dbName}-secret-1`, {
        name: dbSecretName,
        description: "Credentials for Diese RDS instance",
        tags: {
            Name: `${dbName}-secret`,
            Environment: env,
            ManagedBy: "pulumi"
        },
    });

    // Generate a random password for the database
    const randomPassword = aws.secretsmanager.getRandomPassword({
        passwordLength: 64,
        excludeCharacters: "\"@/\\'",
        includeSpace: false,
    }).then(result => result.randomPassword);
    // Create parameter group
    const parameterGroup = new aws.rds.ParameterGroup(`${env}-${dbName}-pg`, {
        family: "postgres17",
        description: "Custom parameter group for PostgreSQL 14",
        parameters: [
            {
                name: "log_connections",
                value: "1"
            },
            {
                name: "log_disconnections",
                value: "1"
            }
        ],
        tags: {
            Name: `${dbName}-pg`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create IAM role for RDS monitoring
    const monitoringRole = new aws.iam.Role(`${env}-${dbName}-monitoring-role`, {
        name: `${env}-${dbName}-monitoring-role`,
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: {
                    Service: "monitoring.rds.amazonaws.com"
                },
                Action: "sts:AssumeRole"
            }]
        })
    });

    // Attach the required policy for RDS monitoring
    const monitoringRolePolicy = new aws.iam.RolePolicyAttachment(`${env}-${dbName}-monitoring-policy`, {
        role: monitoringRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
    });

    // Create RDS instance with enhanced configuration
    const db = new aws.rds.Instance(`${env}-${dbName}`, {
        engine: "postgres",
        engineVersion: "17.4",
        instanceClass: "db.t3.micro",
        allocatedStorage: 20,
        maxAllocatedStorage: 100, // Enable storage autoscaling
        dbName: dbName,
        username: dbUsername,
        password: randomPassword,
        skipFinalSnapshot: env !== "prod", // Only skip final snapshot in non-prod
        finalSnapshotIdentifier: env === "prod" ? `${dbName}-final-snapshot` : undefined,
        vpcSecurityGroupIds: [securityGroup.id],
        dbSubnetGroupName: subnetGroup.name,
        parameterGroupName: parameterGroup.name,
        storageEncrypted: true,
        kmsKeyId: kmsKey.arn,
        backupRetentionPeriod: env === "prod" ? 30 : 7,
        backupWindow: "03:00-04:00",
        autoMinorVersionUpgrade: true,
        multiAz: env === "prod",
        publiclyAccessible: false,
        performanceInsightsEnabled: true,
        monitoringInterval: 60,
        monitoringRoleArn: monitoringRole.arn,
        tags: {
            Name: dbName,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });


    const dbSecretVersion = new aws.secretsmanager.SecretVersion(`${dbName}-secret-version`, {
        secretId: dbSecret.id,
        secretString: pulumi.jsonStringify({
            DB_USERNAME: dbUsername,
            DB_PASSWORD: randomPassword,
            DB_PORT: 5432,
            DB_HOST: db.endpoint,
            DB_NAME: dbName
        }),
    });


    return {
        vpc,
        subnet1,
        subnet2,
        subnetGroup,
        securityGroup,
        db,
        dbEndpoint: db.endpoint,
        dbPort: db.port,
        dbName: db.dbName,
        dbUsername: db.username,
        dbSecretArn: dbSecret.arn,
        dbSecretName: dbSecret.name,
        dbSecretVersionArn: dbSecretVersion.arn, // Export the secret ARN for reference
        dbSecret: dbSecret
    };
}

export default createDatabase;
