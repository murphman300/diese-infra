# Diese Infra Repo

A pulumi TS based repo managing fully secured VPC setup for computed and DB storage, with built-in github-actions based deployment permissions to avoid polling based registry deployments. 

This setup also handles a bastion host which can support routing migrations ran from github actions to the internal database's VPC, providing a DMZ style buffer to running migrations without spinning up ephemereal instances, or having to worry about a standalone server git pulling updated for deployment.

Supports multi-environment updates as well.
