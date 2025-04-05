import * as aws from "@pulumi/aws";
import { Secret } from "@pulumi/aws/secretsmanager";
import * as pulumi from "@pulumi/pulumi";
import { Output } from "@pulumi/pulumi";
import { config } from "process";
import { Repository } from "@pulumi/aws/ecr";
import { DatabaseResources } from "../databases/main";

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

export function createEcsCluster(env: string, ecrImageRepository: Repository, dbResources: DatabaseResources) {
    
    const config = new pulumi.Config();

    const ecsCpu = config.requireNumber("ecs_cpu");
    const ecsMemory = config.requireNumber("ecs_memory");
    const ecsMinContainers = config.requireNumber("ecs_min_containers");
    const ecsMaxContainers = config.requireNumber("ecs_max_containers");
    const ecsCpuTarget = config.requireNumber("ecs_cpu_target");
    const ecsMemoryTarget = config.requireNumber("ecs_memory_target");
    const ecsScaleInCooldown = config.requireNumber("ecs_scale_in_cooldown");
    const ecsScaleOutCooldown = config.requireNumber("ecs_scale_out_cooldown");
    // Create an ECS cluster for Fargate
    const cluster = new aws.ecs.Cluster(`diese-cluster-${env}`, {
        name: `diese-cluster-${env}`,
        tags: {
            Name: `diese-cluster-${env}`,
            Environment: env
        }
    });

    // Create a security group for ECS tasks
    const ecsSecurityGroup = new aws.ec2.SecurityGroup(`diese-ecs-sg-${env}`, {
        vpcId: dbResources.vpc.id,
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

    // Update the database security group to allow access from ECS tasks
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
    })

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
                    containerPort: 80,
                    hostPort: 80,
                    protocol: "tcp"
                }],
                healthCheck: {
                    command: ["CMD-SHELL", "node -e 'fetch(\"http://localhost:80/api/health\").then(r => process.exit(r.ok ? 0 : 1))'"],
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
                        value: "80"
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
                    // DB secrets
                    {
                        name: "DB_USERNAME",
                        valueFrom: `${dbSecretArn}`
                    },
                    {
                        name: "DB_PASSWORD",
                        valueFrom: `${dbSecretArn}`
                    },
                    {
                        name: "DB_HOST",
                        valueFrom: `${dbSecretArn}`
                    },
                    {
                        name: "DB_PORT",
                        valueFrom: `${dbSecretArn}`
                    },
                    {
                        name: "DB_NAME",
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

    // Create auto scaling target for the Fargate service
    type AutoScalingResources = {
        service: pulumi.Output<aws.ecs.Service>;
        scalingTarget: pulumi.Output<aws.appautoscaling.Target>;
        cpuScaling: pulumi.Output<aws.appautoscaling.Policy>;
        memoryScaling: pulumi.Output<aws.appautoscaling.Policy>;
    } | null;
    
    let autoScalingResources: AutoScalingResources = null;
    
    if (env === "staging" || env === "production") {
        // Create the ECS service first to attach auto scaling to
        const service = pulumi
        .all([cluster.name, taskDefinition.arn, ecsSecurityGroup.id])
        .apply(([clusterName, taskDefinitionArn, ecsSecurityGroupId]) => {
            logEcrEvent(env, "Creating ECS service with ECR image", {
                clusterName,
                taskDefinitionArn
            });
            return new aws.ecs.Service(`diese-service-${env}`, {
                cluster: clusterName,
                desiredCount: env === "production" ? 1 : 1,
                launchType: "FARGATE",
                taskDefinition: taskDefinitionArn,
                healthCheckGracePeriodSeconds: 60,
                networkConfiguration: {
                    assignPublicIp: true,
                    subnets: [dbResources.subnet1.id, dbResources.subnet2.id],
                    securityGroups: [ecsSecurityGroupId]
                },
                platformVersion: "LATEST",
                schedulingStrategy: "REPLICA",
                deploymentMinimumHealthyPercent: 100,
                deploymentMaximumPercent: 200
            });
        }).apply(service => {
            logEcrEvent(env, "ECS service created successfully", {
                serviceName: service.name,
                serviceArn: service.id
            });
            return service;
        });

        // Create auto scaling target
        const scalingTarget = pulumi.all([service.name, cluster.name]).apply(([serviceName, clusterName]) => {
            return new aws.appautoscaling.Target(`diese-scaling-target-${env}`, {
                maxCapacity: ecsMaxContainers,
                minCapacity: ecsMinContainers,
                resourceId: pulumi.interpolate`service/${clusterName}/${serviceName}`,
                scalableDimension: "ecs:service:DesiredCount",
                serviceNamespace: "ecs"
            });
        })

        // Create CPU scaling policy
        const cpuScaling = pulumi.all([scalingTarget.resourceId, scalingTarget.scalableDimension, scalingTarget.serviceNamespace]).apply(([resourceId, scalableDimension, serviceNamespace]) => {
            return new aws.appautoscaling.Policy(`diese-cpu-scaling-${env}`, {
                policyType: "TargetTrackingScaling",
                resourceId: resourceId,
                scalableDimension: scalableDimension,
                serviceNamespace: serviceNamespace,
                targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageCPUUtilization"
                },
                    targetValue: 70.0,
                    scaleInCooldown: 300,
                    scaleOutCooldown: 60
                }
            });
        })

        // Create memory scaling policy
        const memoryScaling = pulumi.all([scalingTarget.resourceId, scalingTarget.scalableDimension, scalingTarget.serviceNamespace]).apply(([resourceId, scalableDimension, serviceNamespace]) => {
            return new aws.appautoscaling.Policy(`diese-memory-scaling-${env}`, {
                policyType: "TargetTrackingScaling",
                resourceId: resourceId,
                scalableDimension: scalableDimension,
                serviceNamespace: serviceNamespace,
                targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageMemoryUtilization"
                },
                    targetValue: 80.0,
                    scaleInCooldown: 300,
                    scaleOutCooldown: 60
                }
            });
        })

        autoScalingResources = pulumi.all([service, scalingTarget, cpuScaling, memoryScaling])
            .apply(([svc, target, cpu, mem]) => ({
                service: svc,
                scalingTarget: target,
                cpuScaling: cpu,
                memoryScaling: mem
            }));
    }

    // Create VPC Endpoint for Secrets Manager
    // Create VPC Endpoints for AWS services
    const {
        secretsManagerVpcEndpoint,
        s3VpcEndpoint,
        ecrApiVpcEndpoint,
        ecrDkrVpcEndpoint
    } = pulumi.all([dbResources.vpc.id, ecsSecurityGroup.id, dbResources.subnet1.id, dbResources.subnet2.id]).apply(([vpcId, securityGroupId, subnet1Id, subnet2Id]) => {
        // Secrets Manager VPC Endpoint
        const secretsManagerEndpoint = new aws.ec2.VpcEndpoint(`${env}-diese-secrets-vpc-endpoint`, {
            vpcId,
            serviceName: `com.amazonaws.${aws.config.region}.secretsmanager`,
            vpcEndpointType: "Interface",
            subnetIds: [subnet1Id, subnet2Id],
            securityGroupIds: [securityGroupId],
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
            routeTableIds: [dbResources.vpc.mainRouteTableId],
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
            securityGroupIds: [securityGroupId],
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
            securityGroupIds: [securityGroupId],
            privateDnsEnabled: true,
            tags: {
                Name: `${env}-diese-ecr-dkr-endpoint`,
                Environment: env
            }
        });

        return {
            secretsManagerVpcEndpoint: secretsManagerEndpoint,
            s3VpcEndpoint: s3Endpoint,
            ecrApiVpcEndpoint: ecrApiEndpoint,
            ecrDkrVpcEndpoint: ecrDkrEndpoint
        };
    });

    return {
        cluster,
        taskDefinition,
        taskExecutionRole,
        taskRole,
        logGroup,
        secret,
        secretVersion,
        dbSecret,
        autoScalingResources,
        ecsSecurityGroup,
        secretsManagerVpcEndpoint,
        s3VpcEndpoint,
        ecrApiVpcEndpoint,
        ecrDkrVpcEndpoint
    };
}
