// Standalone Bedrock test — tries several common Claude model/inference-profile
// IDs against your AWS account and tells you exactly which one works.
//
// Usage:
//   cd /root/zyrexai
//   node scripts/test-bedrock.js
//
require('dotenv').config();
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const region = process.env.AWS_REGION || 'us-east-1';
console.log('Using AWS_REGION:', region);
console.log('AWS_BEARER_TOKEN_BEDROCK set:', !!process.env.AWS_BEARER_TOKEN_BEDROCK);
console.log('');

const client = new BedrockRuntimeClient({ region });

// Candidates to try, roughly newest/most-likely-correct first.
const regionPrefix = region.startsWith('us') ? 'us'
  : region.startsWith('eu') ? 'eu'
  : region.startsWith('ap') ? 'apac'
  : 'us';

const candidates = [
  `${regionPrefix}.anthropic.claude-3-5-sonnet-20241022-v2:0`,
  `${regionPrefix}.anthropic.claude-3-5-sonnet-20240620-v1:0`,
  `${regionPrefix}.anthropic.claude-3-sonnet-20240229-v1:0`,
  `${regionPrefix}.anthropic.claude-3-haiku-20240307-v1:0`,
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-haiku-20240307-v1:0'
];

async function tryModel(id) {
  try {
    const command = new ConverseCommand({
      modelId: id,
      messages: [{ role: 'user', content: [{ text: 'Say OK' }] }],
      inferenceConfig: { maxTokens: 10 }
    });
    const res = await client.send(command);
    const reply = res.output?.message?.content?.map(c => c.text).join('') || '';
    console.log(`✅ WORKS: ${id}  -> reply: "${reply.trim()}"`);
    return true;
  } catch (err) {
    console.log(`❌ FAILS: ${id}`);
    console.log(`     ${err.name}: ${err.message}`);
    return false;
  }
}

(async () => {
  let found = null;
  for (const id of candidates) {
    const ok = await tryModel(id);
    if (ok && !found) found = id;
  }
  console.log('');
  if (found) {
    console.log(`👉 Put this in your .env:`);
    console.log(`BEDROCK_MODEL_ID=${found}`);
  } else {
    console.log('None of the common model IDs worked. This usually means:');
    console.log('  1. Model access is not enabled for your AWS account in this region');
    console.log('     -> AWS Console -> Bedrock -> Model access -> enable Anthropic Claude models');
    console.log('  2. Your AWS_BEARER_TOKEN_BEDROCK key is invalid/expired');
    console.log('  3. Your account has no Bedrock access in this region at all -> try a different AWS_REGION (e.g. us-east-1)');
  }
})();
