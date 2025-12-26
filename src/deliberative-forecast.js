import fs from 'fs'
import { deliberativeForecastingAgent } from './deliberative-forecasting-agent.js'

// =============================================================================
// CONFIGURATION
// =============================================================================

const TEST_MODE = process.argv.includes('--test')
const MODELS = ['pro', 'sonnet', 'gpt5']
const CONDITIONS = ['diverse_full', 'diverse_info', 'homo_full', 'diverse_none', 'homo_none', 'homo_info']
const MAX_RETRIES_PER_QUESTION = 3
const RETRY_DELAY_MS = 60_000 // 1 minute
const MAX_TOTAL_FAILURES = 5 // Stop if this many questions have persistent failures


// =============================================================================
// SEEDED RANDOMIZATION
// =============================================================================

const seededRandom = (seed) => {
    const x = Math.sin(seed * 9999) * 10000
    return x - Math.floor(x)
}

const seededShuffle = (array, seed) => {
    const result = [...array]
    let m = result.length
    while (m) {
        const i = Math.floor(seededRandom(seed + m) * m--)
        ;[result[m], result[i]] = [result[i], result[m]]
    }
    return result
}

// =============================================================================
// GROUP COMPOSITION
// =============================================================================

const getGroupComposition = (condition, questionId, questionIndex) => {
    switch (condition) {
        case 'diverse_full':
            return [
                { model: 'pro', infoLabel: 'full' },
                { model: 'sonnet', infoLabel: 'full' },
                { model: 'gpt5', infoLabel: 'full' },
            ]

        case 'diverse_info':
            const infoLabels = seededShuffle(['info1', 'info2', 'info3'], questionId)
            const models = seededShuffle([...MODELS], questionId + 1)
            return [
                { model: models[0], infoLabel: infoLabels[0] },
                { model: models[1], infoLabel: infoLabels[1] },
                { model: models[2], infoLabel: infoLabels[2] },
            ]

        case 'homo_full':
            const homoModel = MODELS[questionIndex % 3]
            return [
                { model: homoModel, infoLabel: 'full', instance: 1 },
                { model: homoModel, infoLabel: 'full', instance: 2 },
                { model: homoModel, infoLabel: 'full', instance: 3 },
            ]

        case 'diverse_none':
            // Diverse models, all with no information
            return [
                { model: 'pro', infoLabel: 'none' },
                { model: 'sonnet', infoLabel: 'none' },
                { model: 'gpt5', infoLabel: 'none' },
            ]

        case 'homo_none':
            // Same model (rotating), all with no information
            const homoNoneModel = MODELS[questionIndex % 3]
            return [
                { model: homoNoneModel, infoLabel: 'none', instance: 1 },
                { model: homoNoneModel, infoLabel: 'none', instance: 2 },
                { model: homoNoneModel, infoLabel: 'none', instance: 3 },
            ]

        case 'homo_info':
            // Same model (rotating), distributed info (each instance has different info)
            const homoInfoModel = MODELS[questionIndex % 3]
            return [
                { model: homoInfoModel, infoLabel: 'info1', instance: 1 },
                { model: homoInfoModel, infoLabel: 'info2', instance: 2 },
                { model: homoInfoModel, infoLabel: 'info3', instance: 3 },
            ]

        default:
            throw new Error(`Unknown condition: ${condition}`)
    }
}

// =============================================================================
// INDEPENDENT FORECAST LOADING
// =============================================================================

const loadIndependentForecast = (questionId, model, infoLabel, instance = null) => {
    const suffix = instance ? `-${instance}` : ''
    const filename = `data/independent-forecasts/${questionId}-${model}-${infoLabel}${suffix}.json`

    if (!fs.existsSync(filename)) {
        return null
    }

    return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

// =============================================================================
// SINGLE DELIBERATIVE FORECAST
// =============================================================================

const generateSingleDeliberativeForecast = async (question, condition, groupComposition, independentForecasts, position) => {
    const agent = groupComposition[position - 1]
    const forecastId = `${question.id}-${condition}-${agent.model}-${position}`
    const outputFile = `data/deliberative-forecasts/${forecastId}.json`

    // Skip if already exists
    if (fs.existsSync(outputFile)) {
        return { status: 'cached', forecastId }
    }

    const ownForecast = independentForecasts[position - 1]
    const otherForecasts = independentForecasts.filter((_, i) => i !== position - 1)

    // Get information text
    const information = agent.infoLabel === 'full'
        ? question.informationPackages.join('\n\n')
        : agent.infoLabel === 'none'
        ? 'No additional information available.'
        : question.informationPackages[parseInt(agent.infoLabel.slice(-1)) - 1]

    try {
        const result = await deliberativeForecastingAgent({
            question,
            information,
            independentForecast: ownForecast,
            otherForecasts,
            model: agent.model,
            condition,
            position,
        })

        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2))

        return { status: 'success', forecastId }
    } catch (error) {
        return { status: 'error', forecastId, error: error.message }
    }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Task definition for retry tracking
const createTask = (question, condition, groupComposition, independentForecasts, position) => ({
    question,
    condition,
    groupComposition,
    independentForecasts,
    position,
    forecastId: `${question.id}-${condition}-${groupComposition[position - 1].model}-${position}`,
})

const processQuestion = async (question, qIndex) => {
    const allTasks = []
    let skipped = 0

    // Collect all tasks for this question
    for (const condition of CONDITIONS) {
        const groupComposition = getGroupComposition(condition, question.id, qIndex)

        // Load independent forecasts
        const independentForecasts = groupComposition.map(agent =>
            loadIndependentForecast(question.id, agent.model, agent.infoLabel, agent.instance)
        )

        // Check if all independent forecasts exist
        if (independentForecasts.some(f => f === null)) {
            console.log(`  Skipping ${condition}: missing independent forecasts`)
            skipped += 3
            continue
        }

        // Add all 3 positions for this condition
        for (let position = 1; position <= 3; position++) {
            allTasks.push(createTask(question, condition, groupComposition, independentForecasts, position))
        }
    }

    if (allTasks.length === 0) {
        return { results: [], persistentFailures: 0, skipped }
    }

    let pendingTasks = [...allTasks]
    let allResults = []
    let retryCount = 0

    while (pendingTasks.length > 0 && retryCount < MAX_RETRIES_PER_QUESTION) {
        if (retryCount > 0) {
            console.log(`  ⏳ Retry ${retryCount}/${MAX_RETRIES_PER_QUESTION}: waiting 60s...`)
            await sleep(RETRY_DELAY_MS)
            console.log(`  🔄 Retrying ${pendingTasks.length} failed forecast(s)...`)
        }

        // Run pending tasks in parallel
        const promises = pendingTasks.map(task =>
            generateSingleDeliberativeForecast(
                task.question,
                task.condition,
                task.groupComposition,
                task.independentForecasts,
                task.position
            )
        )
        const results = await Promise.all(promises)

        // Separate successes/cached from failures
        const succeeded = results.filter(r => r.status === 'success' || r.status === 'cached')
        const failed = results.filter(r => r.status === 'error')

        allResults.push(...succeeded)

        if (failed.length === 0) {
            // All done - clear pending to indicate success
            pendingTasks = []
            break
        }

        // Log failures
        failed.forEach(r => {
            console.log(`    ✗ ${r.forecastId}: ${r.error}`)
        })

        // Prepare for retry
        pendingTasks = pendingTasks.filter(task =>
            failed.some(f => f.forecastId === task.forecastId)
        )

        retryCount++
    }

    // Track persistent failures
    const persistentFailures = pendingTasks.length
    if (persistentFailures > 0) {
        allResults.push(...pendingTasks.map(task => ({
            status: 'persistent_failure',
            forecastId: task.forecastId,
        })))
    }

    return { results: allResults, persistentFailures, skipped }
}

const BATCH_SIZE = 20 // Process this many questions concurrently

const main = async () => {
    let questions = JSON.parse(fs.readFileSync('data/processed/questions.json', 'utf8'))

    if (TEST_MODE) {
        questions = questions.slice(0, 2)
        console.log('TEST MODE: Running on first 2 questions')
    }

    console.log(`Processing ${questions.length} questions in batches of ${BATCH_SIZE}...`)
    console.log(`Config: ${MAX_RETRIES_PER_QUESTION} retries/question, ${MAX_TOTAL_FAILURES} max total failures`)

    fs.mkdirSync('data/deliberative-forecasts', { recursive: true })

    let totalCompleted = 0
    let totalCached = 0
    let totalSkipped = 0
    let totalPersistentFailures = 0
    let questionsWithFailures = []

    // Process questions in batches
    for (let batchStart = 0; batchStart < questions.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, questions.length)
        const batch = questions.slice(batchStart, batchEnd)

        console.log(`\n[Batch ${Math.floor(batchStart/BATCH_SIZE) + 1}/${Math.ceil(questions.length/BATCH_SIZE)}] Questions ${batchStart + 1}-${batchEnd}`)

        // Process all questions in batch concurrently
        const batchPromises = batch.map((question, i) => {
            const qIndex = batchStart + i
            return processQuestion(question, qIndex).then(result => ({
                ...result,
                question,
                qIndex
            }))
        })

        const batchResults = await Promise.all(batchPromises)

        // Process results
        for (const { results, persistentFailures, skipped, question, qIndex } of batchResults) {
            const completed = results.filter(r => r.status === 'success').length
            const cached = results.filter(r => r.status === 'cached').length

            totalCompleted += completed
            totalCached += cached
            totalSkipped += skipped
            totalPersistentFailures += persistentFailures

            if (completed > 0 || persistentFailures > 0) {
                console.log(`  Q${qIndex + 1} (${question.id}): ${completed} completed, ${cached} cached, ${persistentFailures} failed`)
            }

            // Track questions with persistent failures
            if (persistentFailures > 0) {
                questionsWithFailures.push(question.id)

                if (questionsWithFailures.length >= MAX_TOTAL_FAILURES) {
                    console.error(`\n❌ STOPPING: ${MAX_TOTAL_FAILURES} questions with persistent failures`)
                    console.error(`Failed questions: ${questionsWithFailures.join(', ')}`)
                    console.error(`Fix the issue and re-run. Cached forecasts will be skipped.`)
                    process.exit(1)
                }
            }
        }

        console.log(`  Batch total: ${batchResults.reduce((s, r) => s + r.results.filter(x => x.status === 'success').length, 0)} completed`)
    }

    console.log(`\n${'='.repeat(60)}`)
    if (questionsWithFailures.length > 0) {
        console.log(`⚠️  COMPLETED WITH FAILURES`)
        console.log(`  Failed questions: ${questionsWithFailures.join(', ')}`)
    } else {
        console.log(`✅ DONE!`)
    }
    console.log(`  Completed: ${totalCompleted}`)
    console.log(`  Cached: ${totalCached}`)
    console.log(`  Skipped: ${totalSkipped}`)
    console.log(`  Persistent failures: ${totalPersistentFailures}`)
}

main().catch(console.error)
