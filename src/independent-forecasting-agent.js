import { generateObject } from 'ai'
import { getOpenModel } from './agentUtils.js'
import { z } from 'zod'


const generatePrompt = (question, information) => `You are a professional forecaster interviewing for a job.

Your interview question is:
${question.questionTitle}

Question background:
${question.questionDescription}


This question's outcome will be determined by the specific criteria below. These criteria have not yet been satisfied:
${question.questionResolutionCriteria}

${question.questionFinePrint}


Your research assistant's report says:
${information}

Today is ${question.date}.

Before answering you think:
(a) The time left until the outcome to the question is known.
(b) The status quo outcome if nothing changed.
(c) A brief description of a scenario that results in a No outcome.
(d) A brief description of a scenario that results in a Yes outcome.
(e) You write your rationale remembering that good forecasters put extra weight on the status quo outcome since the world changes slowly most of the time. Explain your reasoning and the evidence behind your forecast in detail. Summarise information your received from your research assistant that influences your forecast (if any). Explain why your forecast is not higher, and why it is not lower. Outline what would need to be true for you to update your forecast in either direction.
(f) The last thing you write is your final probabilistic forecast as a number between 0 and 100.

# OUTPUT SCHEMA
{
    "time_left_until_outcome_known": "string",
    "status_quo_outcome": "string",
    "no_outcome_scenario": "string",
    "yes_outcome_scenario": "string",
    "rationale": "string",
    "probability": "number" (0-100)
}`


export const independentForecastingAgent = async (question, information, model, infoLabel, instance = null) => {

    if(!infoLabel || !model) throw new Error('Label and model are required')
    const instanceSuffix = instance ? `-${instance}` : ''
    const forecastId = `${question.id}-${model}-${infoLabel}${instanceSuffix}`

    const prompt = generatePrompt(question, information)


    const schema = z.object({
        time_left_until_outcome_known: z.string(),
        status_quo_outcome: z.string(),
        no_outcome_scenario: z.string(),
        yes_outcome_scenario: z.string(),
        rationale: z.string(),
        probability: z.number().describe('Minimum 0, maximum 100'),
    })

    const result = await generateObject({
        model: getOpenModel(model),
        schema: schema,
        prompt: prompt,
        maxOutputTokens: 10_000,
        providerOptions: {
            openrouter: {
                reasoning: {
                  max_tokens: 5_000,
                },
            },
            anthropic: {
                thinking: { type: 'enabled', budgetTokens: 5_000 },
            },
            openai: {
                reasoning: { effort: "medium", summary: "auto" },
            },
            google: {
                thinkingConfig: { thinkingBudget: -1 }, // dynamic
            },
        },
    })

    return {object: result.object, prompt: prompt, id: forecastId, instance}
}