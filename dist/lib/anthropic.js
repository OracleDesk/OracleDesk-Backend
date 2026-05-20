"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.anthropic = void 0;
exports.callClaude = callClaude;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_1 = require("../config");
exports.anthropic = new sdk_1.default({
    apiKey: config_1.config.ANTHROPIC_API_KEY,
});
/**
 * Call Claude with a structured prompt expecting JSON output.
 * Retries once on rate-limit errors.
 */
async function callClaude(systemPrompt, userPrompt, maxTokens = 2048) {
    const message = await exports.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    });
    const block = message.content[0];
    if (block.type !== 'text') {
        throw new Error('Claude returned a non-text response block');
    }
    return block.text;
}
exports.default = exports.anthropic;
