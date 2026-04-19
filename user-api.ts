import { type anyobject } from "@ceale/util"
import type { LX } from "lx-source-type"
import vm from "node:vm"
import { extractMetadata, createUtils, request } from "./env.ts"
import type { Result } from "./worker-mgr.ts"
import { TimerClass } from "./env.ts"

export interface LxUserApiHandlers {
    onInited?: (payload: LX.InitedPayload) => void
    onUpdateAlert?: (payload: LX.UpdateAlertPayload) => void
    onLog?: (level: string, ...data: any) => void
    onInitError?: (error: any) => void
    onRunError?: (error: any) => void
}

export interface LxUserApiOptions {
    /** 传递给`lx.env`的值，默认为`mobile` */
    env?: LX.API["env"]
    /** 传递给`lx.version`的值，当前为`2.0.0` */
    version?: LX.API["version"]
    /** 脚本执行超时时间，对应 `node:vm` `timeout` 选项，默认为10秒 */
    timeout?: number | undefined
    /** 调试模式，开启后将打印 请求、日志、事件  */
    debug?: boolean
}

export interface IUserApi {
    isInited: boolean
    isInitError: boolean
    isUpdateNeeded: boolean
    isDestroyed: boolean
    waitInit(): Promise<void>
    
    supportPlatform?: LX.InitedPayload["sources"]
    updateAlert?: LX.UpdateAlertPayload
    initError?: any
    
    handlers: LxUserApiHandlers 
    resolve(params: LX.ProviderParams): Promise<Result<{ result: LX.ProviderResult }>>
    destroy(): void
}

export class UserApi implements IUserApi {

    public isInited = false
    public isInitError = false
    public isUpdateNeeded = false
    public isDestroyed = false

    public supportPlatform?: LX.InitedPayload["sources"]
    public updateAlert?: LX.UpdateAlertPayload


    private EVENT_NAMES: LX.EVENT_NAMES = {
        inited: "inited",
        request: "request", 
        updateAlert: "updateAlert"
    }
    private lxApi: LX.API
    private context: anyobject

    private provider?: Function

    public handlers: LxUserApiHandlers
    private options: LxUserApiOptions

    private timer = new TimerClass()
    private initPromise: Promise<void>

    constructor(
        script: string,
        handlers: LxUserApiHandlers = {},
        options: LxUserApiOptions = {}
    ) {
        this.handlers = handlers
        this.options = options
        
        const scriptInfo = extractMetadata(script)
        
        let initResolve: () => void
        this.initPromise = new Promise(resolve => {
            initResolve = resolve
        })

        const innerOn: LX.OnEvent = async (eventName, handler) => {
            if (this.isDestroyed) throw new Error("UserApi destroyed")
            if (options.debug) console.log("on", eventName)
            if (eventName === this.EVENT_NAMES.request) {
                this.provider = handler
            } else {
                throw new Error("Unsupported event name " + eventName)
            }
        }
        const innerSend: LX.SendEvent = async (eventName, data: any) => {
            if (this.isDestroyed) throw new Error("UserApi destroyed") 
            if (options.debug) console.log("send", eventName)
            switch (eventName) {
                case this.EVENT_NAMES.inited:
                    this.isInited = true
                    this.supportPlatform = data.sources
                    initResolve()
                    this.handlers.onInited?.(data)
                    break
                case this.EVENT_NAMES.updateAlert:
                    if (this.isUpdateNeeded) throw new Error("Allow only one update alert")
                    this.isUpdateNeeded = true
                    this.updateAlert = data
                    this.handlers.onUpdateAlert?.(data)
                    break
                default:
                    throw new Error("Unsupported event name " + eventName)
            }
        }

        this.lxApi = {
            env: options?.env ?? "mobile",
            version: options?.version ?? "2.0.0",
            currentScriptInfo: scriptInfo,
            EVENT_NAMES: this.EVENT_NAMES,
            on: innerOn,
            send: innerSend,  
            request: request,
            utils: createUtils()
        }

        const createInnerLog = (level: string) => {
            if (options.debug) {
                return (...args: any) => {
                    console.log(`log(${level})`, ...args)
                    this.handlers.onLog?.(level, ...args)
                }
            } else {
                return handlers?.onLog
                    ? (...data) => handlers.onLog?.(level, ...data)
                    : (() => {})
            }
        }
        const innerConsole = [ "log", "debug", "info", "warn", "error" ]
            .reduce((acc, key) => {
                acc[key] = createInnerLog(key)
                return acc
            }, {})

        this.context = {
            lx: this.lxApi,
            console: innerConsole,
            setTimeout: this.timer.setTimeout,
            clearTimeout: this.timer.clearTimeout,
            setInterval: this.timer.setInterval,
            clearInterval: this.timer.clearInterval
        }
        // Object.setPrototypeOf(content, null) 

        const deleteApiCode = `
            delete globalThis.SuppressedError;
            delete globalThis.Float16Array;
            delete globalThis.Iterator;
            delete globalThis.SharedArrayBuffer;
            delete globalThis.DisposableStack;
            delete globalThis.AsyncDisposableStack;
            delete globalThis.WeakRef;
            delete globalThis.FinalizationRegistry;
            delete globalThis.Intl;
            delete globalThis.ShadowRealm;
            delete globalThis.WebAssembly;
        `
        const code = [ deleteApiCode, script ].join("\n")

        queueMicrotask(() => {
            const timeout = this.options.timeout ?? 10_000
            // if (timeout !== undefined) setTimeout(() => {
            //     if (!this.isInited) {
            //         this.isInitError = true
            //         this.destroy()
            //         initResolve()
            //         this.handlers.onInitError?.(new Error("Timeout"))
            //     }
            // }, timeout)
            try {
                vm.runInNewContext(code, this.context, {
                    // filename:
                    // contextName:
                    // lineOffset: 10,
                    timeout,
                    contextCodeGeneration: {
                        strings: false,
                        wasm: false
                    },
                    importModuleDynamically() {
                        throw new Error("Unsupported dynamic import")
                    }
                })
            } catch (error) {
                if (!this.isInited) {
                    if (this.options.debug) console.log("initError", error)
                    this.isInitError = true
                    this.destroy()
                    initResolve()
                    this.handlers.onInitError?.(error)
                } else {
                    if (this.options.debug) console.log("runError", error)
                    this.handlers.onRunError?.(error)
                }
            }
        })
    }

    async waitInit(): Promise<void> {
        return this.initPromise
    }

    async resolve(params: LX.ProviderParams): Promise<Result<{ result: LX.ProviderResult }>> {
        if (!this.provider) return { success: false, error: new Error("Request handler is not defined") }
        if (this.isDestroyed) return { success: false, error: new Error("UserApi destroyed") }
        try {
            return { success: true , result: await this.provider(params) }
        } catch (error) {
            return { success: false, error }
        }
    }

    destroy() {
        if (this.isDestroyed) return
        this.isDestroyed = true
        this.provider = undefined
        this.handlers = {}
        this.timer.clear()
    }
}