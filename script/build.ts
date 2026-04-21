import { build, BuildConfig } from "bun"

// const workerString = await (
//         await build({
//             entrypoints: [ "worker-host.ts" ],
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
        "import.meta.IS_BUILDED": JSON.stringify(true),
        // "import.meta.WORKER_FILE": JSON.stringify(workerString)
    }
}

await build({
    ...config,
    format: "esm",
    outdir: "lib/esm/",
})

// await build({
//     ...config,
//     format: "cjs",
//     outdir: "lib/cjs/",
// })