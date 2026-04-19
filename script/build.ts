import { build, BuildConfig } from "bun"

// const workerString = await (
//         await build({
//             entrypoints: [ "worker-sub.ts" ],
//             target: "node",
//             format: "esm",
//             packages: "external"
//         })
//     )
//     .outputs[0]
//     .text()

const config: BuildConfig = {
    entrypoints: [ "index.ts", "worker-host.ts" ],
    target: "node",
    packages: "external",
    define: {
        // "globalThis.WORKER_PATH": JSON.stringify("data:text/javascript," + encodeURIComponent(workerString))
        // "globalThis.WORKER_PATH": JSON.stringify("data:text/javascript;base64," + Buffer.from(workerString).toBase64())
        // "globalThis.WORKER_PATH": JSON.stringify(workerString)
    }
}

await build({
    ...config,
    format: "esm",
    outdir: "lib/esm/",
})

await build({
    ...config,
    format: "cjs",
    outdir: "lib/cjs/",
})