import * as cdk from '@aws-cdk/core';
import * as ugali_automation_service from '../lib/ugali-automation-cdk-service';
export enum Stage {
  Dev = "dev",
  Prod = "prod"
}
export class UgaliAutomationCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, stage: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // if (stage === Stage.Prod) {
      new ugali_automation_service.UgaliAutomationService(this, 'UgaliAutomation', stage);
    // } else {

    // }

  }
}
