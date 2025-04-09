import { createEC2Resources, EC2Resources } from "./configuration";
import { createEC2Instances, EC2InstancesResources } from "./instances";
import { EcsClusterResources } from "../webapp";
import { DatabaseResources } from "../databases";

export interface CreateEC2Resources {
    resources: EC2Resources;
    instances: EC2InstancesResources;
}

export function createEC2(env: string, cluster: EcsClusterResources, databases: DatabaseResources) : CreateEC2Resources {
    const name = `${env}-ec2-bastion-host`;
    const resources = createEC2Resources(name, env, cluster);
    const instances = createEC2Instances(env, resources, cluster, databases);
    const bastionToDBSecurityGroupRule = databases.allowlistSecurityGroupInDBVPC(instances.securityGroup, "bastion-ec2");
    return { resources, instances };
}