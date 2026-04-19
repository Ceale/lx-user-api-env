import { type anyobject, tryCatch } from "@ceale/util"
import type { LX } from "lx-source-type"
import needle from "needle"
import crypto from "node:crypto"
import zlib from "node:zlib"


export const extractMetadata = (script: string): LX.ScriptInfo => {
    const data = {} as anyobject
    const metadataText = script
        .split("/*")[1]
        .split("*/")[0]
        .split("\n")
        .filter(line => line.includes("@"))
        .map(line => line.split("@")[1].trim())
        .forEach(line => {
            let state = 0
            const keyChars = [] as any
            const valueChars = [] as any
            // 0:in key, 1:in gap, 2:in value
            for (const char of line) {
                if (state === 0 && char === " ") {
                    state = 1
                } else if (state === 1 && char !== " ") {
                    state = 2
                }
                
                if (state === 0) {
                    keyChars.push(char)
                } else if (state === 2) {
                    valueChars.push(char)
                }
            }
            data[keyChars.join("")] = valueChars.join("")
        })
    return {
        name: data.name ?? "",
        author: data.author ?? "",
        description: data.description ?? "",
        version: data.version ?? "",
        homepage: data.homepage ?? "",
        rawScript: script
    }
}

export const request: LX.Request = (
    url, { method = "get", headers, body, form, formData, timeout },
    callback
) => {
    const data = body ?? form ?? formData ?? null
    const options: needle.NeedleOptions = {
        headers: {
            connection: "close",
            ...headers
        },
        json: !body && (form || formData) ? false : undefined,
        response_timeout: typeof timeout === "number" && timeout > 0 ? Math.min(timeout, 60_000) : 60_000
    }

    const req = needle.request(
        // @ts-ignore
        method, url, data, options,
        (err, res, body) => {
            if (err) callback(err, null, null)
            else {
                const body = tryCatch(() => JSON.parse(res.body)).data ?? res.body
                callback(null, {
                    statusCode: res.statusCode!,
                    statusMessage: res.statusMessage!,
                    headers: res.headers,
                    bytes: res.bytes,
                    body: body,
                    raw: res.raw
                }, body)
            }
        }
    )

    return () => {
        // @ts-ignore
        if (!req?.request?.aborted) req?.request?.abort()
    }
}

export const createUtils: () => LX.Utils = () => ({
    crypto: {
        aesEncrypt(buffer, mode, key, iv) {
            const cipher = crypto.createCipheriv(mode, key, iv)
            return Buffer.concat([cipher.update(buffer), cipher.final()])
        },
        rsaEncrypt(buffer, key) {
            buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
            return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buffer)
        },
        randomBytes(size) {
            return crypto.randomBytes(size)
        },
        md5(str) {
            return crypto.createHash('md5').update(str).digest('hex')
        },
    },
    buffer: {
        // @ts-ignore
        from(...args) {
            // @ts-ignore
            return Buffer.from(...args)
        },
        bufToString(buf, format) {
            // @ts-ignore
            return Buffer.from(buf, 'binary').toString(format)
        },
    },
    zlib: {
        inflate(buf) {
            return new Promise((resolve, reject) => {
                zlib.inflate(buf, (err, data) => {
                    if (err) reject(new Error(err.message))
                    else resolve(data)
                })
            })
        },
        deflate(data) {
            return new Promise((resolve, reject) => {
                zlib.deflate(data, (err, buf) => {
                    if (err) reject(new Error(err.message))
                    else resolve(buf)
                })
            })
        },
    },
})

export class TimerClass {
    private isClear = false;
    private timeout = new Set<any>();
    private interval = new Set<any>();

    setTimeout = (...args: Parameters<typeof setTimeout>) => {
        if (this.isClear) return
        const id = globalThis.setTimeout(...args)
        this.timeout.add(id)
        return id
    };
    clearTimeout = (...args: Parameters<typeof clearTimeout>) => {
        if (this.isClear) return
        const id = args[0]
        this.timeout.delete(id)
        return globalThis.clearTimeout(...args)
    };
    setInterval = (...args: Parameters<typeof setInterval>) => {
        if (this.isClear) return
        const id = globalThis.setInterval(...args)
        this.interval.add(id)
        return id
    };
    clearInterval = (...args: Parameters<typeof clearInterval>) => {
        if (this.isClear) return
        const id = args[0]
        this.interval.delete(id)
        return globalThis.clearInterval(...args)
    };
    clear = () => {
        this.isClear = true
        this.timeout.forEach(id => globalThis.clearTimeout(id))
        this.interval.forEach(id => globalThis.clearInterval(id))
        this.timeout.clear()
        this.interval.clear()
    };
}

