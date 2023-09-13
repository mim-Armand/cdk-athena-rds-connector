import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import {aws_sam as serverless, Fn} from 'aws-cdk-lib';

export class CdkAthenaRdsConnectorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dbName = cdk.Fn.importValue('AthenaDatabaseNameOutput-2');
    const dbInstanceEndpointAddress = cdk.Fn.importValue('dbInstanceEndpointAddress-2');
    const dbInstanceEndpointPort = cdk.Fn.importValue('dbInstanceEndpointPort-2');
    const dbSecurityGroupId = cdk.Fn.importValue('dbSecurityGroupId-2');
    const privateSubnetIds = cdk.Fn.split(',', cdk.Fn.importValue('AthenaVpcPrivateSubnetsOutput-2'));

    // Define IAM role for the connector
    const connectorRole = new iam.Role(this, 'ConnectorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Attach policies to the role
    connectorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    connectorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));
    connectorRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: ["*"],
    }));

    const jdbcConnectionString = `jdbc:postgresql://${dbInstanceEndpointAddress}:${dbInstanceEndpointPort}/my_initial_database`;

    const connector = new serverless.CfnApplication(this, 'PostgresConnector', {
      location: {
        // applicationId: 'arn:aws:serverlessrepo:us-east-1:956415635792:applications/athena-federation-rds',
        applicationId: 'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaPostgreSQLConnector',
        semanticVersion: '2023.35.2'
      },
      parameters: {
        "SpillBucket": "my-spill-bucket-23756",
        // "SecretNameOrPrefix": "my-postgres-secret", // Specify the name or prefix of the secret in Secrets Manager
        "SecretNamePrefix": "DBSecretD58955BC-Aarz2ser4gmV", //todo!
        "LambdaFunctionName": "athenardsconnect", // <-- the function name must start with a lowercase letter and consist only of letters and digits
        "DefaultConnectionString":jdbcConnectionString, //todo!
        "SecurityGroupIds": dbSecurityGroupId, // Use the security group of the RDS instance
        "SubnetIds": Fn.select(0, privateSubnetIds), // Use one of the public subnets of the VPC
      },
      // roleName: connectorRole.roleName, //todo!
    });
  }
}
