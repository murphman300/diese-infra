import * as aws from "@pulumi/aws";
import { Secret } from "@pulumi/aws/secretsmanager";
import * as pulumi from "@pulumi/pulumi";
import { Output } from "@pulumi/pulumi";
import { config } from "process";
import { Repository } from "@pulumi/aws/ecr";
import { DatabaseResources } from "../databases/main";
import { CertificateResources } from "../certificates";

export interface EcsClusterResources {
    cluster: pulumi.Output<aws.ecs.Cluster>;
    taskDefinition: pulumi.Output<aws.ecs.TaskDefinition>;
    taskExecutionRole: pulumi.Output<aws.iam.Role>;
    taskRole: pulumi.Output<aws.iam.Role>;
    computeVpc: pulumi.Output<aws.ec2.Vpc>;
    computeSubnets: pulumi.Output<aws.ec2.Subnet>[];
    logGroup: pulumi.Output<aws.cloudwatch.LogGroup>;
    secret: pulumi.Output<aws.secretsmanager.Secret>;
    secretVersion: pulumi.Output<aws.secretsmanager.SecretVersion>;
    dbSecret: pulumi.Output<Secret>;
    autoScalingResources: {
        service: pulumi.Output<aws.ecs.Service>;
        scalingTarget: pulumi.Output<aws.appautoscaling.Target>;
        cpuScaling: pulumi.Output<aws.appautoscaling.Policy>;
        memoryScaling: pulumi.Output<aws.appautoscaling.Policy>;
    } | null;
    ecsSecurityGroup: pulumi.Output<aws.ec2.SecurityGroup>;
    secretsManagerVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    s3VpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    ecrApiVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    ecrDkrVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    cloudwatchLogsVpcEndpoint: pulumi.Output<aws.ec2.VpcEndpoint>;
    webappLoadBalancer: pulumi.Output<aws.lb.LoadBalancer>;
    webappTargetGroup: pulumi.Output<aws.lb.TargetGroup>;
    webappHttpListener: pulumi.Output<aws.lb.Listener>;
    webappHttpsListener: pulumi.Output<aws.lb.Listener | undefined>;
    migrationTaskDefinition: pulumi.Output<aws.ecs.TaskDefinition>;
}

// Helper function to log ECR events
function logEcrEvent(env: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = {
        timestamp,
        environment: env,
        service: 'ECR',
        message,
        ...(data && { details: data })
    };
    console.log(JSON.stringify(logMessage));
}

export function createEcsCluster(
    env: string,
    ecrImageRepository: Repository,
    dbResources: DatabaseResources,
    migrationsContainerRegistry: Repository,
    certificateResources?: CertificateResources
): EcsClusterResources {
    
    const config = new pulumi.Config();

    const ecsCpu = config.requireNumber("ecs_cpu");
    const ecsMemory = config.requireNumber("ecs_memory");
    const ecsMinContainers = config.requireNumber("ecs_min_containers");
    const ecsMaxContainers = config.requireNumber("ecs_max_containers");
    const ecsCpuTarget = config.requireNumber("ecs_cpu_target");
    const ecsMemoryTarget = config.requireNumber("ecs_memory_target");
    const webAppPort = config.requireNumber("web_app_port");
    const ecsScaleInCooldown = config.requireNumber("ecs_scale_in_cooldown");
    const ecsScaleOutCooldown = config.requireNumber("ecs_scale_out_cooldown");

    // Create a VPC for compute resources
    const computeVpc = new aws.ec2.Vpc(`diese-compute-vpc-${env}`, {
        cidrBlock: "10.1.0.0/16", // Different CIDR from DB VPC
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: {
            Name: `diese-compute-vpc-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create an Internet Gateway for the compute VPC
    const computeIgw = new aws.ec2.InternetGateway(`diese-compute-igw-${env}`, {
        vpcId: computeVpc.id,
        tags: {
            Name: `diese-compute-igw-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create public subnets in different AZs
    const computeSubnet1 = new aws.ec2.Subnet(`diese-compute-subnet-1-${env}`, {
        vpcId: computeVpc.id,
        cidrBlock: "10.1.1.0/24",
        availabilityZone: "ca-central-1a",
        mapPublicIpOnLaunch: true, // Enable auto-assign public IP
        tags: {
            Name: `diese-compute-subnet-1-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    const computeSubnet2 = new aws.ec2.Subnet(`diese-compute-subnet-2-${env}`, {
        vpcId: computeVpc.id,
        cidrBlock: "10.1.2.0/24",
        availabilityZone: "ca-central-1b",
        mapPublicIpOnLaunch: true, // Enable auto-assign public IP
        tags: {
            Name: `diese-compute-subnet-2-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create route table for public subnets
    const computeRouteTable = new aws.ec2.RouteTable(`diese-compute-rt-${env}`, {
        vpcId: computeVpc.id,
        routes: [
            {
                cidrBlock: "0.0.0.0/0",
                gatewayId: computeIgw.id
            }
        ],
        tags: {
            Name: `diese-compute-rt-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Associate route table with public subnets
    const rtAssociation1 = new aws.ec2.RouteTableAssociation(`diese-rt-assoc-1-${env}`, {
        subnetId: computeSubnet1.id,
        routeTableId: computeRouteTable.id
    });

    const rtAssociation2 = new aws.ec2.RouteTableAssociation(`diese-rt-assoc-2-${env}`, {
        subnetId: computeSubnet2.id,
        routeTableId: computeRouteTable.id
    });

    // Create VPC peering connection between compute VPC and DB VPC
    const vpcPeering = new aws.ec2.VpcPeeringConnection(`diese-vpc-peering-${env}`, {
        vpcId: computeVpc.id,
        peerVpcId: dbResources.vpc.id,
        autoAccept: true,
        tags: {
            Name: `diese-vpc-peering-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Add route to DB VPC in compute route table
    const computeToDbRoute = new aws.ec2.Route(`diese-compute-to-db-route-${env}`, {
        routeTableId: computeRouteTable.id,
        destinationCidrBlock: "10.0.0.0/16", // DB VPC CIDR
        vpcPeeringConnectionId: vpcPeering.id
    });

    // Add route from DB VPC to compute VPC
    const dbToComputeRoute = new aws.ec2.Route(`diese-db-to-compute-route-${env}`, {
        routeTableId: dbResources.vpc.mainRouteTableId,
        destinationCidrBlock: "10.1.0.0/16", // Compute VPC CIDR
        vpcPeeringConnectionId: vpcPeering.id
    });

    // Create security group for ECS tasks in compute VPC
    const ecsSecurityGroup = new aws.ec2.SecurityGroup(`diese-ecs-sg-${env}`, {
        vpcId: computeVpc.id,
        description: "Security group for ECS tasks",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow HTTP inbound"
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow HTTPS inbound for VPC endpoints"
            }
        ],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow all outbound traffic"
            }
        ],
        tags: {
            Name: `diese-ecs-sg-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create security group for VPC endpoints
    const vpcEndpointSecurityGroup = pulumi.all([computeVpc.id, ecsSecurityGroup.id]).apply(([vpcId, ecsSecurityGroupId]) => {
        return new aws.ec2.SecurityGroup(`diese-vpc-endpoint-sg-${env}`, {
            vpcId: vpcId,
            description: "Security group for VPC endpoints",
            ingress: [
                {
                    protocol: "tcp",
                    fromPort: 443,
                    toPort: 443,
                    securityGroups: [ecsSecurityGroupId],
                    description: "Allow HTTPS from ECS tasks"
                }
            ],
            egress: [
                {
                    protocol: "-1",
                    fromPort: 0,
                    toPort: 0,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow all outbound traffic"
                }
            ],
            tags: {
                Name: `diese-vpc-endpoint-sg-${env}`,
                Environment: env,
                ManagedBy: "pulumi"
            }
        });
    });

    // Update the database security group to allow access from compute VPC's ECS tasks
    const dbIngressRule = pulumi.all([dbResources.securityGroup.id, ecsSecurityGroup.id]).apply(([dbSecurityGroupId, ecsSecurityGroupId]) => {
        return new aws.ec2.SecurityGroupRule(`diese-db-from-ecs-${env}`, {
            type: "ingress",
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            sourceSecurityGroupId: ecsSecurityGroupId,
            securityGroupId: dbSecurityGroupId,
            description: "Allow PostgreSQL access from ECS tasks"
        });
    });

    // Create an ECS cluster for Fargate
    const cluster = new aws.ecs.Cluster(`diese-cluster-${env}`, {
        name: `diese-cluster-${env}`,
        tags: {
            Name: `diese-cluster-${env}`,
            Environment: env
        }
    });

    // Create a task execution role for Fargate - this role is used by ECS itself
    const taskExecutionRole = new aws.iam.Role(`diese-task-execution-role-${env}`, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ecs-tasks.amazonaws.com"
                }
            }]
        }),
        description: "Role that the ECS service uses to execute tasks",
        tags: {
            Name: `diese-task-execution-role-${env}`,
            Environment: env
        }
    });

    // Create a task role for Fargate - this role is used by the application
    const taskRole = new aws.iam.Role(`diese-task-role-${env}`, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ecs-tasks.amazonaws.com"
                }
            }]
        }),
        description: "Role that the application within the ECS container assumes",
        tags: {
            Name: `diese-task-role-${env}`,
            Environment: env
        }
    });

    // Attach the ECS Task Execution policy to the task execution role
    // This policy allows ECS to pull container images and publish logs
    new aws.iam.RolePolicyAttachment(`diese-task-execution-policy-${env}`, {
        role: taskExecutionRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
    });

    // Add ECR pull permissions for any repository
    const ecrPullPolicy = new aws.iam.Policy(`diese-ecr-pull-policy-${env}`, {
        description: "Policy allowing pulling images from any ECR repository",
        policy: pulumi.all([ecrImageRepository.arn, migrationsContainerRegistry.arn])
            .apply(([ecrArn, migrationsArn]) => JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: [
                            "ecr:GetAuthorizationToken"
                        ],
                        Resource: "*"
                    },
                    {
                        Effect: "Allow",
                        Action: [
                            "ecr:BatchGetImage",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:BatchCheckLayerAvailability"
                        ],
                        Resource: [
                            ecrArn,
                            migrationsArn
                        ]
                    }
                ]
            }))
    });

    // Attach ECR pull policy to task execution role
    new aws.iam.RolePolicyAttachment(`diese-ecr-pull-policy-attachment-${env}`, {
        role: taskExecutionRole.name,
        policyArn: ecrPullPolicy.arn
    });

    // Create a secrets manager secret for the application
    const secret = new aws.secretsmanager.Secret(`diese-web-app-secrets-${env}`, {
        name: `diese-web-app-secrets-${env}`,
        description: `Secrets for the diese application in ${env} environment`,
        tags: {
            Environment: env,
            Name: `diese-web-app-secrets-${env}`
        }
    });

    // Initialize the secret with default values
    const secretValues = {
        API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "dev-api-key-example",
        JWT_SECRET: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : pulumi.interpolate`jwt-secret-${pulumi.getStack()}-${Date.now()}`,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_" + (env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "clerk-dev-key-example"),
        CLERK_SECRET_KEY: "sk_test_" + (env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "clerk-dev-secret-example"),
        GEMINI_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "gemini-dev-key-example",
        GROQ_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "groq-dev-key-example",
        OPENAI_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "sk-openai-dev-key-example"
    };

    // Create a secret version with the values
    const secretVersion = new aws.secretsmanager.SecretVersion(`diese-web-app-secret-version-${env}`, {
        secretId: secret.id,
        secretString: JSON.stringify(secretValues)
    });

    // Get reference to existing DB secret
    const dbSecret = dbResources.dbSecret;

    // Create a more specific policy for Secrets Manager access for the task execution role
    // This is more secure than using the ReadOnly managed policy
    const secretsAccessPolicy = new aws.iam.Policy(`diese-secrets-access-policy-${env}`, {
        description: "Policy granting access to specific secrets for the task",
        policy: pulumi.all([secret.arn, dbSecret.arn]).apply(([secretArn, dbSecretArn]) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "secretsmanager:GetSecretValue"
                    ],
                    Resource: [
                        secretArn,
                        dbSecretArn
                    ]
                }
            ]
        }))
    });

    // Attach the Secrets Manager access policy to the task execution role
    new aws.iam.RolePolicyAttachment(`diese-secrets-policy-attachment-${env}`, {
        role: taskExecutionRole.name,
        policyArn: secretsAccessPolicy.arn
    });

    // Create CloudWatch log group for container logs
    const logGroup = new aws.cloudwatch.LogGroup(`diese-log-group-${env}`, {
        name: `/ecs/diese-${env}`,
        retentionInDays: 30,
        tags: {
            Environment: env,
            Name: `diese-log-group-${env}`
        }
    });

    // Create CloudWatch logs policy for the task role
    const logsPolicy = new aws.iam.Policy(`diese-logs-policy-${env}`, {
        description: "Policy allowing task to write logs to CloudWatch",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    Resource: `arn:aws:logs:*:*:log-group:/ecs/diese-${env}:*`
                }
            ]
        })
    });

    // Attach the logs policy to the task role
    new aws.iam.RolePolicyAttachment(`diese-logs-policy-attachment-${env}`, {
        role: taskRole.name,
        policyArn: logsPolicy.arn
    });

    // Create CloudWatch log group for ECR events
    const ecrLogGroup = new aws.cloudwatch.LogGroup(`diese-ecr-logs-${env}`, {
        name: `/ecr/diese-${env}`,
        retentionInDays: 30,
        tags: {
            Environment: env,
            Name: `diese-ecr-logs-${env}`
        }
    });

    // Log ECR repository details
    ecrImageRepository.repositoryUrl.apply(url => {
        logEcrEvent(env, "ECR Repository URL obtained", { url });
    });

    ecrImageRepository.arn.apply(arn => {
        logEcrEvent(env, "ECR Repository ARN obtained", { arn });
    });

    // Create CloudWatch logs policy for ECR events
    const ecrLogsPolicy = new aws.iam.Policy(`diese-ecr-logs-policy-${env}`, {
        description: "Policy allowing ECR to write logs to CloudWatch",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    Resource: `arn:aws:logs:*:*:log-group:/ecr/diese-${env}:*`
                }
            ]
        })
    });

    // Attach ECR logs policy to task execution role
    new aws.iam.RolePolicyAttachment(`diese-ecr-logs-policy-attachment-${env}`, {
        role: taskExecutionRole.name,
        policyArn: ecrLogsPolicy.arn
    });

    // Determine CPU and memory based on environment
    let cpu = "256";
    let memory = "512";

    
    let authorizedDomains: string[] = config.requireObject<string[]>("authorized_domains") || [];

    // Set higher resources for staging and production environments
    if ( env === "production") {
        cpu = "1024"
        memory = "2048"
    }

    const taskDefinitionName = `diese-web-app-task-definition-${env}`

    const taskDefinition = pulumi
    .all([secret.arn, dbSecret.arn, ecrImageRepository.repositoryUrl, taskExecutionRole.arn, taskRole.arn])
    .apply(([secretArn, dbSecretArn, ecrImageUri, taskExecutionRoleArn, taskRoleArn]) => {
        console.log(secretArn, 'secretArn')
        return new aws.ecs.TaskDefinition(taskDefinitionName, {
            family: `diese-web-app-task-${env}`,
            cpu: ecsCpu.toString(),
            memory: ecsMemory.toString(),
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            executionRoleArn: taskExecutionRoleArn,
            taskRoleArn: taskRoleArn, // Assign the task role to the task definition
            containerDefinitions: JSON.stringify([{
                name: `diese-container-${env}`,
                image: ecrImageUri,
                essential: true,
                memoryReservation: ecsMemoryTarget, // 80% of task memory
                cpu: ecsCpuTarget, // 80% of task CPU
                portMappings: [{
                    containerPort: webAppPort,
                    hostPort: webAppPort,
                    protocol: "tcp"
                }],
                healthCheck: {
                    command: ["CMD-SHELL", `node -e 'fetch(\"http://localhost:${webAppPort}/api/health\").then(r => process.exit(r.ok ? 0 : 1))'`],
                    interval: 15,
                    timeout: 5,
                    retries: 3,
                    startPeriod: 60
                },
                linuxParameters: {
                    initProcessEnabled: true
                },
                user: "1001:1001",
                environment: [
                    {
                        name: "NODE_ENV",
                        value: env
                    },
                    {
                        name: "PORT",
                        value: `${webAppPort}`
                    },
                    {
                        name: "AUTHORIZED_DOMAINS",
                        value: authorizedDomains.join(",")
                    }
                ],
                logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                        "awslogs-group": `/ecs/diese-${env}`,
                        "awslogs-region": aws.config.region || "us-east-1",
                        "awslogs-stream-prefix": "ecs"
                    }
                },
                secrets: [
                    {
                        name: "JWT_SECRET",
                        valueFrom: `${secretArn}`
                    },
                    // Identity Provider Secrets
                    {
                        name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
                        valueFrom: `${secretArn}`
                    },
                    {
                        name: "CLERK_SECRET_KEY",
                        valueFrom: `${secretArn}`
                    },
                    // LLM Secrets
                    {
                        name: "GEMINI_API_KEY",
                        valueFrom: `${secretArn}`
                    },
                    {
                        name: "GROQ_API_KEY",
                        valueFrom: `${secretArn}`
                    },
                    {
                        name: "OPENAI_API_KEY",
                        valueFrom: `${secretArn}`
                    },
                    {
                        name: "DATABASE_URL",
                        valueFrom: `${dbSecretArn}`
                    }
                ]
            }])
        });
    });

    // Log when task definition is created with ECR image
    taskDefinition.apply(td => {
        logEcrEvent(env, "Task Definition created with ECR image", {
            taskDefinitionArn: td.arn,
            family: td.family
        });
    });

    // Create ALB Security Group
    const albSecurityGroup = new aws.ec2.SecurityGroup(`diese-alb-sg-${env}`, {
        vpcId: computeVpc.id,
        description: "Security group for ALB",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow HTTP inbound"
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow HTTPS inbound"
            }
        ],
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow all outbound traffic"
            }
        ],
        tags: {
            Name: `diese-alb-sg-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Allow inbound traffic from ALB to ECS tasks
    const ecsIngressRule = new aws.ec2.SecurityGroupRule(`diese-ecs-from-alb-${env}`, {
        type: "ingress",
        fromPort: webAppPort,
        toPort: webAppPort,
        protocol: "tcp",
        sourceSecurityGroupId: albSecurityGroup.id,
        securityGroupId: ecsSecurityGroup.id,
        description: "Allow inbound traffic from ALB"
    });

    // Create Application Load Balancer
    const webappLoadBalancer = new aws.lb.LoadBalancer(`diese-alb-${env}`, {
        internal: false,
        loadBalancerType: "application",
        securityGroups: [albSecurityGroup.id],
        subnets: [computeSubnet1.id, computeSubnet2.id],
        enableDeletionProtection: env === "prod",
        idleTimeout: 60,
        tags: {
            Name: `diese-alb-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create Target Group with Fargate-optimized settings
    const webappTargetGroup = new aws.lb.TargetGroup(`diese-tg-${env}`, {
        port: webAppPort,
        protocol: "HTTP",
        vpcId: computeVpc.id,
        targetType: "ip",
        deregistrationDelay: 30,
        healthCheck: {
            enabled: true,
            path: "/api/health",
            port: `${webAppPort}`,
            protocol: "HTTP",
            healthyThreshold: 2,
            unhealthyThreshold: 2,
            timeout: 5,
            interval: 15,
            matcher: "200-299"
        },
        stickiness: {
            type: "lb_cookie",
            cookieDuration: 86400,
            enabled: true
        },
        tags: {
            Name: `diese-tg-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create HTTP Listener (will redirect to HTTPS)
    const webappHttpListener = new aws.lb.Listener(`diese-http-listener-${env}`, {
        loadBalancerArn: webappLoadBalancer.arn,
        port: 80,
        protocol: "HTTP",
        defaultActions: [{
            type: "redirect",
            redirect: {
                port: "443",
                protocol: "HTTPS",
                statusCode: "HTTP_301"
            }
        }],
        tags: {
            Name: `diese-http-listener-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    });

    // Create HTTPS Listener with improved security settings
    const webappHttpsListener = certificateResources ? new aws.lb.Listener(`diese-https-listener-${env}`, {
        loadBalancerArn: webappLoadBalancer.arn,
        port: 443,
        protocol: "HTTPS",
        sslPolicy: "ELBSecurityPolicy-TLS-1-2-2017-01",
        certificateArn: certificateResources.webAppCertificate.arn,
        defaultActions: [{
            type: "forward",
            targetGroupArn: webappTargetGroup.arn
        }],
        tags: {
            Name: `diese-https-listener-${env}`,
            Environment: env,
            ManagedBy: "pulumi"
        }
    }) : undefined;

    // Create auto scaling target for the Fargate service
    type AutoScalingResources = {
        service: pulumi.Output<aws.ecs.Service>;
        scalingTarget: pulumi.Output<aws.appautoscaling.Target>;
        cpuScaling: pulumi.Output<aws.appautoscaling.Policy>;
        memoryScaling: pulumi.Output<aws.appautoscaling.Policy>;
    } | null;
    
    let autoScalingResources: AutoScalingResources = null;

    // Update the service configuration to use the target group
    if (env === "staging" || env === "production") {
        autoScalingResources = pulumi.all([
            cluster.name,
            taskDefinition.arn,
            ecsSecurityGroup.id,
            computeSubnet1.id,
            computeSubnet2.id,
            webappTargetGroup.arn
        ]).apply(([clusterName, taskDefinitionArn, ecsSecurityGroupId, subnet1Id, subnet2Id, tgArn]) => {
            logEcrEvent(env, "Creating ECS service with ECR image", {
                clusterName,
                taskDefinitionArn
            });

            const service = new aws.ecs.Service(`diese-service-${env}`, {
                cluster: clusterName,
                desiredCount: env === "production" ? 1 : 1,
                launchType: "FARGATE",
                taskDefinition: taskDefinitionArn,
                healthCheckGracePeriodSeconds: 60,
                networkConfiguration: {
                    assignPublicIp: true,
                    subnets: [subnet1Id, subnet2Id],
                    securityGroups: [ecsSecurityGroupId]
                },
                loadBalancers: [{
                    targetGroupArn: tgArn,
                    containerName: `diese-container-${env}`,
                    containerPort: webAppPort
                }],
                platformVersion: "LATEST",
                schedulingStrategy: "REPLICA",
                deploymentController: {
                    type: "ECS"
                },
                deploymentMinimumHealthyPercent: 100,
                deploymentMaximumPercent: 200,
                waitForSteadyState: true
            });

            // Create auto scaling target
            const scalingTarget = new aws.appautoscaling.Target(`diese-scaling-target-${env}`, {
                maxCapacity: ecsMaxContainers,
                minCapacity: ecsMinContainers,
                resourceId: pulumi.interpolate`service/${clusterName}/${service.name}`,
                scalableDimension: "ecs:service:DesiredCount",
                serviceNamespace: "ecs"
            });

            // Create CPU scaling policy
            const cpuScaling = new aws.appautoscaling.Policy(`diese-cpu-scaling-${env}`, {
                policyType: "TargetTrackingScaling",
                resourceId: scalingTarget.resourceId,
                scalableDimension: scalingTarget.scalableDimension,
                serviceNamespace: scalingTarget.serviceNamespace,
                targetTrackingScalingPolicyConfiguration: {
                    predefinedMetricSpecification: {
                        predefinedMetricType: "ECSServiceAverageCPUUtilization"
                    },
                    targetValue: 70.0,
                    scaleInCooldown: 300,
                    scaleOutCooldown: 60
                }
            });

            // Create memory scaling policy
            const memoryScaling = new aws.appautoscaling.Policy(`diese-memory-scaling-${env}`, {
                policyType: "TargetTrackingScaling",
                resourceId: scalingTarget.resourceId,
                scalableDimension: scalingTarget.scalableDimension,
                serviceNamespace: scalingTarget.serviceNamespace,
                targetTrackingScalingPolicyConfiguration: {
                    predefinedMetricSpecification: {
                        predefinedMetricType: "ECSServiceAverageMemoryUtilization"
                    },
                    targetValue: 80.0,
                    scaleInCooldown: 300,
                    scaleOutCooldown: 60
                }
            });

            return {
                service,
                scalingTarget,
                cpuScaling,
                memoryScaling
            };
        });
    }

    // Create VPC Endpoint for Secrets Manager
    // Create VPC Endpoints for AWS services
    const {
        secretsManagerVpcEndpoint,
        s3VpcEndpoint,
        ecrApiVpcEndpoint,
        ecrDkrVpcEndpoint,
        cloudwatchLogsVpcEndpoint
    } = pulumi.all([computeVpc.id, computeVpc.mainRouteTableId, vpcEndpointSecurityGroup.id, computeSubnet1.id, computeSubnet2.id]).apply(([vpcId, mainRouteTableId, endpointSecurityGroupId, subnet1Id, subnet2Id]) => {
        // Secrets Manager VPC Endpoint
        const secretsManagerEndpoint = new aws.ec2.VpcEndpoint(`${env}-diese-secrets-vpc-endpoint`, {
            vpcId: vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.secretsmanager`,
            vpcEndpointType: "Interface",
            subnetIds: [subnet1Id, subnet2Id],
            securityGroupIds: [endpointSecurityGroupId],
            privateDnsEnabled: true,
            tags: {
                Name: `${env}-diese-secrets-vpc-endpoint`,
                Environment: env
            }
        });

        // S3 Gateway VPC Endpoint
        const s3Endpoint = new aws.ec2.VpcEndpoint(`${env}-diese-s3-vpc-endpoint`, {
            vpcId: vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.s3`,
            vpcEndpointType: "Gateway",
            routeTableIds: [mainRouteTableId],
            tags: {
                Name: `${env}-diese-s3-vpc-endpoint`,
                Environment: env
            }
        });

        // ECR API VPC Endpoint
        const ecrApiEndpoint = new aws.ec2.VpcEndpoint(`${env}-diese-ecr-api-endpoint`, {
            vpcId: vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.ecr.api`,
            vpcEndpointType: "Interface",
            subnetIds: [subnet1Id, subnet2Id],
            securityGroupIds: [endpointSecurityGroupId],
            privateDnsEnabled: true,
            tags: {
                Name: `${env}-diese-ecr-api-endpoint`,
                Environment: env
            }
        });

        // ECR DKR VPC Endpoint
        const ecrDkrEndpoint = new aws.ec2.VpcEndpoint(`${env}-diese-ecr-dkr-endpoint`, {
            vpcId: vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.ecr.dkr`,
            vpcEndpointType: "Interface",
            subnetIds: [subnet1Id, subnet2Id],
            securityGroupIds: [endpointSecurityGroupId],
            privateDnsEnabled: true,
            tags: {
                Name: `${env}-diese-ecr-dkr-endpoint`,
                Environment: env
            }
        });

        // CloudWatch Logs VPC Endpoint
        const cloudwatchLogsEndpoint = new aws.ec2.VpcEndpoint(`${env}-diese-cloudwatch-logs-endpoint`, {
            vpcId: vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.logs`,
            vpcEndpointType: "Interface",
            subnetIds: [subnet1Id, subnet2Id],
            securityGroupIds: [endpointSecurityGroupId],
            privateDnsEnabled: true,
            tags: {
                Name: `${env}-diese-cloudwatch-logs-endpoint`,
                Environment: env
            }
        });

        return {
            secretsManagerVpcEndpoint: secretsManagerEndpoint,
            s3VpcEndpoint: s3Endpoint,
            ecrApiVpcEndpoint: ecrApiEndpoint,
            ecrDkrVpcEndpoint: ecrDkrEndpoint,
            cloudwatchLogsVpcEndpoint: cloudwatchLogsEndpoint
        };
    });

    // Create a task definition for the migrations container
    const migrationTaskDefinition = pulumi
    .all([secret.arn, dbSecret.arn, migrationsContainerRegistry.repositoryUrl, taskExecutionRole.arn, taskRole.arn])
    .apply(([secretArn, dbSecretArn, migrationsImageUri, taskExecutionRoleArn, taskRoleArn]) => {
        return new aws.ecs.TaskDefinition(`diese-migration-task-definition-${env}`, {
            family: `${env}-diese-web-app-db-migrations-repository`,
            cpu: ecsCpu.toString(),
            memory: ecsMemory.toString(),
            networkMode: "awsvpc",  // Required for Fargate
            requiresCompatibilities: ["FARGATE"],
            executionRoleArn: taskExecutionRoleArn,
            taskRoleArn: taskRoleArn,
            containerDefinitions: JSON.stringify([{
                name: `diese-migrations-container-${env}`,
                image: `${migrationsImageUri}:latest`,
                essential: true,
                memoryReservation: ecsMemoryTarget,
                cpu: ecsCpuTarget,
                environment: [
                    {
                        name: "NODE_ENV",
                        value: env
                    }
                ],
                logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                        "awslogs-group": `/ecs/diese-${env}`,
                        "awslogs-region": aws.config.region || "us-east-1",
                        "awslogs-stream-prefix": "migrations",
                        "awslogs-create-group": "true"
                    }
                },
                secrets: [
                    {
                        name: "DATABASE_URL",
                        valueFrom: `${dbSecretArn}`
                    }
                ]
            }])
        });
    });

    // Add a comment to explain how to run the migration task with the correct network configuration
    // When running the task, use this command:
    // aws ecs run-task \
    //   --cluster diese-cluster-staging \
    //   --task-definition staging-diese-web-app-db-migrations-repository \
    //   --launch-type FARGATE \
    //   --network-configuration "awsvpcConfiguration={subnets=[subnet-1,subnet-2],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"

    return {
        cluster: pulumi.output(cluster),
        taskDefinition: pulumi.output(taskDefinition),
        taskExecutionRole: pulumi.output(taskExecutionRole),
        taskRole: pulumi.output(taskRole),
        computeVpc: pulumi.output(computeVpc),
        computeSubnets: [pulumi.output(computeSubnet1), pulumi.output(computeSubnet2)],
        logGroup: pulumi.output(logGroup),
        secret: pulumi.output(secret),
        secretVersion: pulumi.output(secretVersion),
        dbSecret: pulumi.output(dbSecret),
        autoScalingResources,
        ecsSecurityGroup: pulumi.output(ecsSecurityGroup),
        secretsManagerVpcEndpoint: pulumi.output(secretsManagerVpcEndpoint),
        s3VpcEndpoint: pulumi.output(s3VpcEndpoint),
        ecrApiVpcEndpoint: pulumi.output(ecrApiVpcEndpoint),
        ecrDkrVpcEndpoint: pulumi.output(ecrDkrVpcEndpoint),
        cloudwatchLogsVpcEndpoint: pulumi.output(cloudwatchLogsVpcEndpoint),
        webappLoadBalancer: pulumi.output(webappLoadBalancer),
        webappTargetGroup: pulumi.output(webappTargetGroup),
        webappHttpListener: pulumi.output(webappHttpListener),
        webappHttpsListener: pulumi.output(webappHttpsListener),
        migrationTaskDefinition: pulumi.output(migrationTaskDefinition)
    };
}
