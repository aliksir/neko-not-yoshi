#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WHITELIST_PATTERNS = [
  // Cloud providers & services (AWS)
  /^(AWS|Amazon|EC2|S3|RDS|Lambda|ECS|EBS|ELB|ALB|NLB|CloudFront|CloudWatch|IAM|VPC|Route\s?53|SES|SNS|SQS|DynamoDB|Aurora|Redshift|Athena|Glue|Kinesis|EMR|SageMaker|Fargate|EKS|ECR|CodePipeline|CodeBuild|CodeDeploy|CloudFormation|CloudTrail|AWS Config|GuardDuty|Security Hub|IAM Identity Center|Inspector|WAF|Shield|Macie|Systems Manager|SSM|Secrets Manager|ACM|KMS|Step Functions|EventBridge|AppSync|Cognito|Amplify|Lightsail|Elastic Beanstalk|Batch|Transit Gateway|Direct Connect|PrivateLink|Global Accelerator|NAT Gateway|Security Group|NACL|DMS|AMI|ElastiCache|AWS Bedrock|S3 Transfer Acceleration|ECS Auto Scaling|AWS Direct Connect|Direct Connect Gateway|RDS Multi-AZ|RDS PostgreSQL\s?\d+)$/i,
  // Cloud providers (Azure/GCP/OCI)
  /^(Azure|GCP|Google Cloud|OCI|Oracle Cloud|Compute Engine|Cloud Run|BigQuery|Dataflow|Pub\/Sub|Cloud Functions|Cloud Storage|App Engine|Vertex AI|Google Cloud Platform|Azure AI|Azure OpenAI|Microsoft Foundry|Google Cloud Japan|Gemini for Google Cloud|Generative AI on Vertex AI|Google Cloud Assured Workloads|Azure Government|Azure Monitor|Log Analytics)$/i,
  // Tech companies
  /^(Microsoft|Google|Anthropic|OpenAI|xAI|Meta|Apple|Oracle|IBM|Salesforce|SAP|VMware|Red Hat|HashiCorp|Datadog|Elastic|MongoDB Inc|Cloudflare|Fastly|Akamai|Dynatrace|New Relic|Splunk|PagerDuty|JetBrains|GitHub|GitLab|Atlassian|NIST|Google DeepMind|Microsoft Research|Microsoft Japan|Google Cloud Japan)$/i,
  // AI products & models
  /^(ChatGPT|Claude|Gemini|Grok|Copilot|GPT-\d+\w*|Llama|Mistral|LLM|RLHF|ChatGPT Enterprise|Grok Business|Gemini Enterprise|Azure OpenAI Service|Copilot for M365|Copilot Studio|Copilot in Windows|Copilot for Microsoft 365|GitHub Copilot|Bing Chat Enterprise|Azure AI Foundry|Azure AI Studio|NotebookLM|NotebookLM Enterprise|Model Garden|Anthropic Claude|Meta Llama|Agentspace|Gemini for Google Workspace)$/i,
  // OS & databases
  /^(Windows|Linux|Ubuntu|CentOS|RHEL|Debian|macOS|iOS|Android|Oracle|PostgreSQL|MySQL|SQL Server|MongoDB|Redis|Elasticsearch|Memcached|MariaDB|SQLite|Cassandra|Neo4j|NetApp ONTAP)$/i,
  // Tech products & tools
  /^(Apache|Nginx|Tomcat|IIS|Node\.js|Python|Java|PHP|Ruby|Go|Rust|TypeScript|JavaScript|C\+\+|\.NET|Spring|Django|Rails|Express|React|Vue|Angular|Next\.js|Docker|Kubernetes|Terraform|Ansible|Jenkins|Jira|Slack|Teams|Zoom|Grafana|Prometheus|Zabbix|Nagios|Fluentd|Logstash|Kibana|Sentry|CircleCI|ArgoCD|Helm|Vault|Consul|Istio|Envoy|vCenter|vSphere Client|Redmine|Backlog|Confluence|Notion|Figma|Miro|DataSpider)$/i,
  // Compliance & standards
  /^(ISMAP|SOC\s?2|SOC 2 Type I+|ISO\s?2700\d+|ISO\s?27701|HIPAA|GDPR|CCPA|FedRAMP|FedRAMP High|IRAP|FISC|JIS Q \d+:\d+|DPA|SDLC|個情法)$/i,
  // Protocols & tech acronyms
  /^(API|SDK|CLI|GUI|UI|UX|SaaS|PaaS|IaaS|CDN|CI\/CD|DevOps|SRE|ITSM|ITIL|CMDB|DR|BCP|RPO|RTO|SLA|SLO|SLI|KPI|OKR|ROI|PoC|MVP|ETL|ELT|CDC|OLAP|OLTP|RPA|ML|AI|NLP|RAG|IoT|MQTT|ISMS|SOC|SIEM|IDS|IPS|DLP|MDM|SSO|MFA|PKI|HSM|TPM|NW|SOC|RFP|EDI|AISI|BMS|GitOps|gRPC|GraphQL|REST|SOAP|OAuth|SAML|OIDC|JWT|SSL|TLS|HTTPS|HTTP|TCP|UDP|DNS|SMTP|FTP|SSH|SFTP|LDAP|SNMP|NTP|ICMP|BGP|OSPF|VLAN|CIDR|NAT|VPN|IPsec|WireGuard)$/i,
  // Generic Japanese business/IT terms
  /^(顧客|サンプル|個人情報|事業者|ユーザ|ユーザー|インフラ|経営層|国民|政府職員|府省庁|機密性[0-3]情報|生成AIシステム|政府情報システム|AIシステム|AIプロダクト|セキュリティ監査|バックアップ|新人エンジニア|解答・解説|基盤エージェント|ハイパーバイザ|ストレージ|ブートローダ|スイムレーン\d*)$/,
  // Generic roles
  /^(PM|BA|PL|SE|PG|テストチーム|移行チーム|USER|ACCOUNT)$/,
  // Placeholder/sample patterns
  /^(XXX|xxx|A社|r-xxxx)/,
  /^(XXX.+|xxx-.+|第XX-.+号)$/,
  /株式会社$/,
  // Generic resource naming patterns
  /^(prod|stg|dev|dr)[-_](account|env|server)/i,
  /^(app|batch|db|mgmt|pub)[-_]sub[-_]/i,
  /^(vpc|igw|subnet|sg|nacl|rtb|eip)[-_]/i,
  /^ap-northeast-\d$/,
  // Generic infra terms
  /^(APサーバ|DBサーバ|WEB-EDI|ERPパッケージ|DBスナップショット|CloudWatchアラーム)$/,
  // AI safety/policy terms
  /^(Red Team|Content moderation|Safety eval|Model Card|Model Spec|Status Page|Trust Portal|Usage Policies|Acceptable Use Policy|Safety Best Practices|Preparedness Framework|Research Index|Copyright Shield|Enterprise Compliance|Responsible AI|Safety Filters|Grounding|Generative AI Indemnification|Copilot Copyright Commitment|Google AI Principles|Responsible AI Practices|Frontier Safety Framework|Security Bulletin|Vertex AI Data Governance|Vertex AI Search|Responsible AI Toolkit|Compliance Center|AI Blog|Content Filter|Responsible AI Standard|Citations|Web Browsing)$/i,
  // Security terms
  /^(Security Operation Center|SOC|MSRC|Premier Support|Office of Responsible AI)$/i,
  // Cloud compound service names (AWS/Azure/GCP multi-word)
  /^(VPC Interface Endpoint|ElastiCache Redis|AWS .+|Azure .+|Google Cloud .+|Microsoft .+|ChatGPT .+|Copilot .+|Gemini .+|Vertex AI .+|Bing .+|OpenAI .+)$/i,
  // Oracle variants
  /^Oracle\s?Cloud$/i,
  // vCenter/vSphere variants
  /^v(Center|Sphere)\s/i,
  // Google Workspace & products
  /^Google\s(Workspace|DeepMind|AI|全体)/i,
  // Compliance compound (SOC 2 Type 2, ISO 270xx, DPA variants)
  /^SOC\s?\d\sType\s/i,
  /^ISO\s?\d{5}/i,
  /^DPA/,
  // Policy/safety terms & AI governance
  /^(deprecation schedule|Service Terms|SLA$)/i,
  /Responsible AI/i,
  /Compliance API/i,
  /Content moderation/i,
  /Grounding with/i,
  /コンソーシアム$/,
  /ガイド$/,
  /セキュリティ基準$/,
  // Training/test material
  /^(新人|研修|カリキュラム|理解度)/,
  /チェックテスト$/,
  // Generic system name with placeholder suffix
  /システム[A-Z]$/,
  // Product + サーバ suffix
  /サーバ$/,
  // Single common English word
  /^Security$/i,
  // SATO (public brand)
  /^SATO$/,
  // Infrastructure JP terms
  /^(東京接続|デュアル|冗長|ロケーション)/,
  // Config file names
  /^(fstab|initramfs|AppServerPolicy|BatchServerPolicy|AppDeployer|ReadOnly|BatchOperator)$/,
  // Day/test patterns
  /^Day\d+/,
  // Generic process names
  /^(停止起動フロー|環境変更申請フロー|禁止事項一覧|リソース拡縮|EDI連携)$/,
  // AMAZON (all caps = brand, not customer)
  /^AMAZON$/i,
  // Short generic tokens
  /^(app|web|api|db|log|vpc)$/i,
];

function isWhitelisted(value) {
  return WHITELIST_PATTERNS.some(p => p.test(value));
}

function main() {
  const args = process.argv.slice(2);
  const candidatesPath = args[0] || 'C:/work/依頼事項/_ngword-candidates.json';
  const outputPath = args[1] || 'C:/work/依頼事項/_ngword-filtered-v2.json';

  if (!existsSync(candidatesPath)) {
    console.error('候補ファイルが見つかりません:', candidatesPath);
    process.exit(1);
  }

  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const filtered = [];
  const removed = [];

  for (const c of candidates) {
    if (isWhitelisted(c.value)) {
      removed.push(c);
    } else {
      filtered.push(c);
    }
  }

  const byCat = {};
  for (const c of filtered) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const catStr = Object.entries(byCat).map(([k, v]) => k + ':' + v).join(', ');

  const removedByCat = {};
  for (const c of removed) removedByCat[c.category] = (removedByCat[c.category] || 0) + 1;
  const removedStr = Object.entries(removedByCat).map(([k, v]) => k + ':' + v).join(', ');

  console.log('元候補:', candidates.length);
  console.log('ホワイトリスト除外:', removed.length, '(' + removedStr + ')');
  console.log('残り:', filtered.length, '(' + catStr + ')');

  writeFileSync(outputPath, JSON.stringify(filtered, null, 2) + '\n', 'utf8');
  console.log('保存:', outputPath);

  const removedPath = outputPath.replace('.json', '-removed.json');
  writeFileSync(removedPath, JSON.stringify(removed, null, 2) + '\n', 'utf8');
  console.log('除外リスト:', removedPath);
}

main();
