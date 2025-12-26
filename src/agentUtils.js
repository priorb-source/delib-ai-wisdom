
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import dotenv from 'dotenv';
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const modelMapOpenrouter = {
    pro: 'google/gemini-2.5-pro',
    sonnet: 'anthropic/claude-sonnet-4.5',
    gpt5: 'openai/gpt-5',
};


export const getOpenModel = (modelName) => {
    if (!OPENROUTER_API_KEY) throw new Error('OpenRouter API key not configured');
    const openrouter = createOpenRouter({
        apiKey: OPENROUTER_API_KEY,
        extraBody: {
            usage: {
                include: true,
            },
        },
    });
    const model = modelMapOpenrouter[modelName];
    if (!model) throw new Error('Invalid model: ' + modelName);
    return openrouter(model);
};