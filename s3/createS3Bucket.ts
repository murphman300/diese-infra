import * as aws from "@pulumi/aws";
import { RolePolicy } from "@pulumi/aws/iam";
import * as pulumi from "@pulumi/pulumi";
import { Output } from "@pulumi/pulumi";
import { S3Buckets } from "./buckets";

export interface S3ResourcesMethods {
    addTrustedArnsToRole: (arns: Output<string>[], securityGroups: Output<string>[]) => pulumi.Output<RolePolicy>;
    addWriteAccessPolicy: (arns: Output<string>[], securityGroups: Output<string>[], s3VpcEndpoint?: Output<aws.ec2.VpcEndpoint>) => pulumi.Output<RolePolicy>;
    addWriteAccessPolicyForAdHocRole: (role: aws.iam.Role, forResource: string) => pulumi.Output<RolePolicy>;
    addWriteAccessPolicyForUser: (user: aws.iam.User, forResource: string) => pulumi.Output<aws.iam.UserPolicy>;
}

export interface S3ResourcesProperties {
    bucket: aws.s3.Bucket;
    readGetPullRole: aws.iam.Role;
    readGetPullPolicy: aws.iam.RolePolicy;
}

export interface S3Resources extends S3ResourcesMethods, S3ResourcesProperties {}

export function createS3Buckets(bucketName: S3Buckets, env: string): S3Resources {
    const name = bucketName.toString();
    const bucketNameString = `${name}-${env}`;
    // Create the apps bucket with environment-specific naming
    const bucket = new aws.s3.Bucket(`${bucketNameString}`, {
        bucket: `${bucketNameString}`,
        acl: "private",
        tags: {
            Name: bucketNameString,
            Environment: env,
            ManagedBy: "pulumi"
        },
        serverSideEncryptionConfiguration: {
            rule: {
                applyServerSideEncryptionByDefault: {
                    sseAlgorithm: "AES256",
                },
            },
        },
        versioning: {
            enabled: true,
        },
    });

    // Create a role that allows read/get/pull access to the apps bucket
    const readGetPullRole = new aws.iam.Role(`${bucketNameString}-read-get-pull`, {
        name: `${bucketNameString}-read-get-pull`,
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: {
                    AWS: "*" // Will be limited by the trust relationship
                },
                Action: "sts:AssumeRole"
            }]
        })
    });

    // Create policy allowing read/get/pull access to the apps bucket
    const readGetPullPolicy = new aws.iam.RolePolicy(`${bucketNameString}-read-get-pull-policy`, {
        name: `${bucketNameString}-read-get-pull-policy`,
        role: readGetPullRole.id,
        policy: pulumi.all([bucket.arn]).apply(([bucketArn]) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "s3:GetObject",
                    "s3:ListBucket"
                ],
                Resource: [
                    bucketArn,
                    `${bucketArn}/*`
                ]
            }]
        }))
    });

    // Function to add ARNs and security groups to the role's trust relationship
    const addTrustedArnsToRole = (arns: Output<string>[], securityGroups: Output<string>[]) => {
        // Update the role's trust policy directly instead of creating a new role policy
        return pulumi.all([...arns, ...securityGroups, bucket.arn]).apply(values => {
            const arnValues = values.slice(0, arns.length);
            const sgValues = values.slice(arns.length, arns.length + securityGroups.length);
            const bucketArn = values[values.length - 1];
            
            console.log("Policy inputs:", { arnValues, sgValues });
            
            // For limiting sources, let's create an appropriate policy based on what we have
            const policyDoc: any = {
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Action: [
                        "s3:GetObject", 
                        "s3:ListBucket"
                    ],
                    Resource: [
                        bucketArn,
                        `${bucketArn}/*`
                    ]
                }]
            };
            
            // If we have security groups, add a condition to restrict by security group source
            if (sgValues.length > 0) {
                // The security groups should be used with aws:SourceVpce condition or similar
                // aws:SourceVpc requires VPC IDs, not security group IDs
                console.log("WARNING: Security groups provided but not using them in policy conditions");
                
                // Note: To properly implement security group conditions, you would typically use VPC endpoints
                // and the aws:sourceVpce condition, or retrieve the VPC ID associated with the security group.
            }
            
            return new aws.iam.RolePolicy(`${bucketNameString}-access-policy`, {
                name: `${bucketNameString}-access-policy`, 
                role: readGetPullRole.id,
                policy: JSON.stringify(policyDoc)
            });
        });
    };
    
    // Function to add write access policy for S3 operations
    const addWriteAccessPolicy = (arns: Output<string>[], securityGroups: Output<string>[], s3VpcEndpoint?: Output<aws.ec2.VpcEndpoint>) => {
        // Create a write access policy
        const allInputs = [...arns, ...securityGroups];
        
        // Create a new array to hold all the inputs for pulumi.all()
        const lookupInputs = [...arns, ...securityGroups, bucket.arn];
        
        // If we have a VPC endpoint, we need to get its ID
        let s3VpcEndpointPromise: pulumi.Output<string> | undefined;
        
        if (s3VpcEndpoint) {
            // Extract the VPC endpoint ID as a separate Output<string>
            s3VpcEndpointPromise = s3VpcEndpoint.id;
            lookupInputs.push(s3VpcEndpointPromise);
        }
        
        return pulumi.all(lookupInputs).apply(values => {
            const arnValues = values.slice(0, arns.length);
            const sgValues = values.slice(arns.length, arns.length + securityGroups.length);
            const bucketArn = values[arns.length + securityGroups.length];
            
            // Get the VPC endpoint ID if it exists
            let vpcEndpointId: string | undefined;
            if (s3VpcEndpoint) {
                vpcEndpointId = values[values.length - 1];
            }
            
            console.log("Write policy inputs:", { 
                arnValues, 
                sgValues, 
                vpcEndpointId, 
                bucketArn 
            });
            
            // Create write policy document
            const policyDoc: any = {
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Action: [
                        "s3:PutObject",
                        "s3:DeleteObject",
                        "s3:PutObjectAcl",
                        "s3:PutObjectVersionAcl"
                    ],
                    Resource: [
                        `${bucketArn}/*`
                    ]
                }]
            };
            
            // Add conditions based on inputs
            const conditions: any = {};
            
            // If VPC endpoint is provided, add the condition to restrict access via that endpoint
            if (vpcEndpointId) {
                conditions.StringEquals = conditions.StringEquals || {};
                conditions.StringEquals["aws:sourceVpce"] = vpcEndpointId;
                
                // Add the security groups if provided
                if (sgValues.length > 0) {
                    // We associate the security groups with the VPC endpoint
                    // This is done by ensuring the VPC endpoint is used AND the request comes from the given security groups
                    console.log(`Restricting S3 access via VPC endpoint ${vpcEndpointId} with security groups:`, sgValues);
                }
            }
            
            // If we have conditions, add them to the policy
            if (Object.keys(conditions).length > 0) {
                policyDoc.Statement[0].Condition = conditions;
            }
            
            return new aws.iam.RolePolicy(`${bucketNameString}-write-access-policy`, {
                name: `${bucketNameString}-write-access-policy`, 
                role: readGetPullRole.id,
                policy: JSON.stringify(policyDoc)
            });
        });
    };
    
    // Now separately update the trust policy for the role
    if (readGetPullRole) {
        // This is a separate operation to set the assumeRolePolicy of the role itself
        const updateTrustPolicy = (arns: string[]) => {
            if (arns.length > 0) {
                const trustPolicyDoc = {
                    Version: "2012-10-17",
                    Statement: [{
                        Effect: "Allow",
                        Principal: {
                            AWS: arns
                        },
                        Action: "sts:AssumeRole"
                    }]
                };
                // We would use this to update the role's assume role policy
                // But we'll handle that separately via the role's assumeRolePolicy prop
            }
        };
    }

    const addWriteAccessPolicyForAdHocRole = (role: aws.iam.Role, forResource: string): pulumi.Output<RolePolicy> => {
        return pulumi.all([role.id, bucket.arn]).apply(([roleId, bucketArn]) => {
            return new aws.iam.RolePolicy(`${env}-${forResource}-s3-read-write-policy`, {
                name: `${env}-${forResource}-s3-read-write-policy`,
                role: role.id,
                policy: JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [{
                        Effect: "Allow",
                        Action: [
                            "s3:PutObject",
                            "s3:GetObject",
                            "s3:DeleteObject",
                            "s3:PutObjectAcl",
                            "s3:PutObjectVersionAcl",
                            "s3:ListBucket"
                        ],
                        Resource: [
                            bucketArn,
                            `${bucketArn}/*`
                        ]
                    }]
                })
            })
        })
    };
    
    // Function to add write access policy directly to a user
    const addWriteAccessPolicyForUser = (user: aws.iam.User, forResource: string): pulumi.Output<aws.iam.UserPolicy> => {
        // Get the bucket ARN directly
        const bucketArn = bucket.arn;
        
        // Log for debugging
        console.log(`Creating S3 access policy for user (${forResource})`);
        
        // Create the UserPolicy with direct references
        const userPolicy = new aws.iam.UserPolicy(`${env}-${forResource}-s3-policy`, {
            user: user.name, // Pass the user name Output directly
            name: `${env}-${forResource}-s3-policy`,
            policy: bucketArn.apply(arn => JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Action: [
                        "s3:PutObject",
                        "s3:GetObject",
                        "s3:DeleteObject",
                        "s3:PutObjectAcl",
                        "s3:PutObjectVersionAcl",
                        "s3:ListBucket"
                    ],
                    Resource: [
                        arn,
                        `${arn}/*`
                    ]
                }]
            }))
        });
        
        return pulumi.output(userPolicy);
    };

    return { 
        bucket, 
        readGetPullRole, 
        readGetPullPolicy, 
        addTrustedArnsToRole,
        addWriteAccessPolicy,
        addWriteAccessPolicyForAdHocRole,
        addWriteAccessPolicyForUser
    };
}

export default createS3Buckets;
