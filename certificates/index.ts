import * as aws from "@pulumi/aws";

export function createCertificates(env: string) {
    // Create ACM certificate for staging.diese.ai
    const name = `${env}-diese-certificate`;
    const webAppCertificate = new aws.acm.Certificate(name, {
        domainName: "staging.diese.ai",
        validationMethod: "DNS",
        tags: {
            Environment: env,
            Name: "staging-diese-certificate"
        }
    });

    // Create validation record
    const stagingCertificateValidationName = `${env}-diese-certificate-validation`;
    const webAppCertificateValidation = new aws.acm.CertificateValidation(stagingCertificateValidationName, {
        certificateArn: webAppCertificate.arn,
        validationRecordFqdns: webAppCertificate.domainValidationOptions.apply(
            options => options.map(option => option.resourceRecordName)
        )
    });

    return {
        webAppCertificate,
        webAppCertificateValidation
    };
}

export default createCertificates;
