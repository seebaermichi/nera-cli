// What the GitHub and the Netlify client share: reading an HTTP answer.

// The response body as JSON, or null when it is empty or not JSON.
export async function readJson(response) {
    const text = await response.text()
    if (text === '') return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}
