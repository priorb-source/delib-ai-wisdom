import { generateObject } from 'ai'
import { getOpenModel } from './agentUtils.js'
import { z } from 'zod'


const formatIndependentForecastAsProse = (forecast) => {
    return `${forecast.rationale}\n\n**Forecast: ${forecast.probability}%**`
}


const buildDeliberationMessages = (independentForecast, otherForecasts, question, information) => {

    // Message 1: Original independent forecast prompt (reconstructed)
    const originalPrompt = `You are a professional forecaster interviewing for a job.

Your interview question is:
${question.questionTitle}

Question background:
${question.questionDescription}

Resolution criteria:
${question.questionResolutionCriteria}

${question.questionFinePrint}

Your research assistant's report says:
${information}

Today is ${question.date}.

Before answering you write:
(a) The time left until the outcome is known.
(b) The status quo outcome if nothing changed.
(c) A scenario that results in a No outcome.
(d) A scenario that results in a Yes outcome.
(e) Your rationale, explaining your reasoning and evidence.
(f) Your final probabilistic forecast (0-100).`

    // Message 2: Agent's own independent forecast as prose
    const ownForecastProse = formatIndependentForecastAsProse(independentForecast)

    // Message 3: Deliberation prompt with other forecasters' analyses
    const otherAnalyses = otherForecasts.map((f, i) => {
        return `## Forecaster ${i + 2}'s Analysis

${formatIndependentForecastAsProse(f)}`
    }).join('\n\n---\n\n')

    const deliberationPrompt = `You are now in a deliberation phase with two other expert forecasters.

Please review their analyses:

---

${otherAnalyses}

---

Consider their reasoning any new information or arguments carefully:
- What evidence or arguments did they raise that you hadn't considered?
- Do you find their reasoning convincing? Why or why not?
- Should you update your forecast based on their input? If so, how much? If not, why not?

Weigh your previous analysis and critically review your own reasoning and evidence in light of any new information or arguments, as if you were participating in a structured deliberation process.

Based on your thoughtful analysis, provide a clear and concise review of all the arguments and information you have considered, your updated rationale, and your updated forecast. Do not feel obligated to update your forecast if you do not think it is warranted.

Provide your updated analysis and forecast.`

    return [
        { role: 'user', content: originalPrompt },
        { role: 'assistant', content: ownForecastProse },
        { role: 'user', content: deliberationPrompt },
    ]
}


const OUTPUT_SCHEMA = z.object({
    review: z.string().describe('Your thoughts on the other forecasters reasoning'),
    rationale: z.string().describe('Your updated reasoning and analysis. If you change your forecast up or down, explain why you changed it and how much you changed it. If you do not change your forecast, explain why you did not change it.'),
    probability: z.number().describe('Your final probabilistic forecast. Minimum 0, maximum 100.'),
})


export const deliberativeForecastingAgent = async ({
    question,
    information,
    independentForecast,
    otherForecasts,
    model,
    condition,
    position,
}) => {
    if (!independentForecast || !otherForecasts || otherForecasts.length !== 2) {
        throw new Error('Need own independent forecast and exactly 2 other forecasts')
    }
    if (!model || !condition || !position) {
        throw new Error('Model, condition, and position are required')
    }

    const forecastId = `${question.id}-${condition}-${model}-${position}`
    const groupId = `${question.id}-${condition}`

    const messages = buildDeliberationMessages(
        independentForecast.forecast,
        otherForecasts.map(f => f.forecast),
        question,
        information
    )

    const result = await generateObject({
        model: getOpenModel(model),
        schema: OUTPUT_SCHEMA,
        messages: messages,
        maxOutputTokens: 10_000,
        providerOptions: {
            openrouter: {
                reasoning: { max_tokens: 5_000 },
            },
            anthropic: {
                thinking: { type: 'enabled', budgetTokens: 5_000 },
            },
            openai: {
                reasoning: { effort: 'medium', summary: 'auto' },
            },
            google: {
                thinkingConfig: { thinkingBudget: -1 },
            },
        },
    })

    return {
        forecastId,
        questionId: question.id,
        condition,
        model,
        position,
        infoLabel: independentForecast.infoLabel,
        groupId,
        independentForecastId: independentForecast.forecastId,
        otherForecastIds: otherForecasts.map(f => f.forecastId),
        forecast: result.object,
        usage: result.usage,
    }
}
