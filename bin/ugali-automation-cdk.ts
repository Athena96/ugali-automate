#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { UgaliAutomationCdkStack } from '../lib/ugali-automation-cdk-stack';

const app = new cdk.App();
new UgaliAutomationCdkStack(app, 'UgaliAutomationCdkStack-dev', 'dev');
new UgaliAutomationCdkStack(app, 'UgaliAutomationCdkStack-prod', 'prod');
