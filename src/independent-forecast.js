import fs from 'fs'
import { independentForecastingAgent } from './independent-forecasting-agent.js'

// =============================================================================
// CONFIGURATION
// =============================================================================

const TEST_MODE = process.argv.includes('--test')
const MODELS = ['pro', 'sonnet', 'gpt5']
const MAX_RETRIES_PER_QUESTION = 3
const RETRY_DELAY_MS = 60_000 // 1 minute
const MAX_TOTAL_FAILURES = 5 // Stop if this many questions have persistent failures


// =============================================================================
// SEEDED RANDOMIZATION (must match deliberative-forecast.js)
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
// FORECAST REQUIREMENTS
// =============================================================================

const getRequiredForecasts = (questionId, qIndex) => {
    const required = []
    const seen = new Set()

    const addForecast = (model, infoLabel, instance = null) => {
        const key = `${model}-${infoLabel}-${instance || ''}`
        if (!seen.has(key)) {
            seen.add(key)
            required.push({ model, infoLabel, instance })
        }
    }

    // 1. diverse_full: all 3 models with shared info
    for (const model of MODELS) {
        addForecast(model, 'full')
    }

    // 2. diverse_info: randomized info assignment
    const infoLabels = seededShuffle(['info1', 'info2', 'info3'], questionId)
    const models = seededShuffle([...MODELS], questionId + 1)
    for (let i = 0; i < 3; i++) {
        addForecast(models[i], infoLabels[i])
    }

    // 3. homo_full: 3 instances of rotating model
    const homoModel = MODELS[qIndex % 3]
    for (let instance = 1; instance <= 3; instance++) {
        addForecast(homoModel, 'full', instance)
    }

    // 4. sense_check: all 3 models with no info
    for (const model of MODELS) {
        addForecast(model, 'none')
    }

    // 5. homo_none: 3 instances of rotating model with no info
    // (mirrors homo_full but with none instead of full)
    for (let instance = 1; instance <= 3; instance++) {
        addForecast(homoModel, 'none', instance)
    }

    // 6. diverse_none: all 3 models with no info (already covered by sense_check)
    // No additional forecasts needed

    // 7. homo_info: 3 instances of rotating model with distributed info
    // Instance 1 gets info1, instance 2 gets info2, instance 3 gets info3
    const homoInfoLabels = ['info1', 'info2', 'info3']
    for (let instance = 1; instance <= 3; instance++) {
        addForecast(homoModel, homoInfoLabels[instance - 1], instance)
    }

    return required
}

// =============================================================================
// INFORMATION MAPPING
// =============================================================================

const getInformation = (question, infoLabel) => {
    const infoPkgs = question.informationPackages
    switch (infoLabel) {
        case 'none': return 'No additional information available.'
        case 'full': return infoPkgs.join('\n\n')
        case 'info1': return infoPkgs[0]
        case 'info2': return infoPkgs[1]
        case 'info3': return infoPkgs[2]
        default: throw new Error(`Unknown info label: ${infoLabel}`)
    }
}

// =============================================================================
// SINGLE FORECAST GENERATION
// =============================================================================

const generateSingleForecast = async (question, req) => {
    const instanceSuffix = req.instance ? `-${req.instance}` : ''
    const forecastId = `${question.id}-${req.model}-${req.infoLabel}${instanceSuffix}`
    const outputFile = `data/independent-forecasts/${forecastId}.json`

    // Skip if already exists
    if (fs.existsSync(outputFile)) {
        return { status: 'cached', forecastId }
    }

    const information = getInformation(question, req.infoLabel)

    try {
        const forecast = await independentForecastingAgent(
            question,
            information,
            req.model,
            req.infoLabel,
            req.instance
        )

        const result = {
            forecastId: forecast.id,
            questionId: question.id,
            model: req.model,
            infoLabel: req.infoLabel,
            instance: req.instance,
            information: information,
            forecast: forecast.object,
            prompt: forecast.prompt,
        }

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

const processQuestion = async (question, qIndex, requiredForecasts) => {
    let pendingForecasts = [...requiredForecasts]
    let allResults = []
    let retryCount = 0

    while (pendingForecasts.length > 0 && retryCount < MAX_RETRIES_PER_QUESTION) {
        if (retryCount > 0) {
            console.log(`  ⏳ Retry ${retryCount}/${MAX_RETRIES_PER_QUESTION}: waiting 60s...`)
            await sleep(RETRY_DELAY_MS)
            console.log(`  🔄 Retrying ${pendingForecasts.length} failed forecast(s)...`)
        }

        // Run pending forecasts in parallel
        const promises = pendingForecasts.map(req => generateSingleForecast(question, req))
        const results = await Promise.all(promises)

        // Separate successes/cached from failures
        const succeeded = results.filter(r => r.status === 'success' || r.status === 'cached')
        const failed = results.filter(r => r.status === 'error')

        allResults.push(...succeeded)

        if (failed.length === 0) {
            // All done - clear pending to indicate success
            pendingForecasts = []
            break
        }

        // Log failures
        failed.forEach(r => {
            console.log(`    ✗ ${r.forecastId}: ${r.error}`)
        })

        // Prepare for retry - find the original requests for failed forecasts
        pendingForecasts = pendingForecasts.filter(req => {
            const instanceSuffix = req.instance ? `-${req.instance}` : ''
            const forecastId = `${question.id}-${req.model}-${req.infoLabel}${instanceSuffix}`
            return failed.some(f => f.forecastId === forecastId)
        })

        retryCount++
    }

    // If we still have pending (failed) forecasts after all retries
    const finalFailed = pendingForecasts.length
    if (finalFailed > 0) {
        allResults.push(...pendingForecasts.map(req => {
            const instanceSuffix = req.instance ? `-${req.instance}` : ''
            return {
                status: 'persistent_failure',
                forecastId: `${question.id}-${req.model}-${req.infoLabel}${instanceSuffix}`
            }
        }))
    }

    return {
        results: allResults,
        persistentFailures: finalFailed,
    }
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

    fs.mkdirSync('data/independent-forecasts', { recursive: true })

    let totalCompleted = 0
    let totalCached = 0
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
            const requiredForecasts = getRequiredForecasts(question.id, qIndex)
            return processQuestion(question, qIndex, requiredForecasts).then(result => ({
                ...result,
                question,
                qIndex
            }))
        })

        const batchResults = await Promise.all(batchPromises)

        // Process results
        for (const { results, persistentFailures, question, qIndex } of batchResults) {
            const completed = results.filter(r => r.status === 'success').length
            const cached = results.filter(r => r.status === 'cached').length

            totalCompleted += completed
            totalCached += cached
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
        console.log(`  Completed: ${totalCompleted}`)
        console.log(`  Cached: ${totalCached}`)
        console.log(`  Persistent failures: ${totalPersistentFailures}`)
        console.error(`\n❌ DO NOT proceed to deliberative stage until failures are resolved.`)
        console.error(`Fix issues and re-run. Cached forecasts will be skipped.`)
        process.exit(1)
    } else {
        console.log(`✅ DONE!`)
        console.log(`  Completed: ${totalCompleted}`)
        console.log(`  Cached: ${totalCached}`)
        console.log(`  Total: ${totalCompleted + totalCached}`)
    }
}

main().catch(console.error)
