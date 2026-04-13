import { type anyobject } from "@ceale/util"
import type { LX } from "lx-source-type"
import vm from "node:vm"
import { extractMetadata, request, createUtils } from "./env.ts"
import type { Result } from "./worker-main.ts"

export interface LxUserApiHandlers {
    onInited?: (payload: LX.InitedPayload) => void
    onUpdateAlert?: (payload: LX.UpdateAlertPayload) => void
    onLog?: (...data: any) => void
    onInitError?: (error: any) => void
    onRunError?: (error: any) => void
}

export interface LxUserApiOptions {
    debug?: boolean
}

export interface IUserApi {
    isInited: boolean
    isInitError: boolean
    isUpdateNeeded: boolean
    isDestroyed: boolean
    
    supportPlatform?: LX.InitedPayload["sources"]
    updateAlert?: LX.UpdateAlertPayload
    
    handlers: LxUserApiHandlers
    resolve(params: LX.ProviderParams): Promise<Result<{ result: LX.ProviderResult }>>
    destroy(): void
}

export class UserApi implements IUserApi{

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

    private provider?: Function

    public handlers: LxUserApiHandlers
    private options: LxUserApiOptions

    constructor(
        script: string,
        handlers: LxUserApiHandlers = {},
        options: LxUserApiOptions = {}
    ) {
        this.handlers = handlers
        this.options = options

        const scriptInfo = extractMetadata(script)
        const EVENT_NAMES = this.EVENT_NAMES
        const innerOn: LX.OnEvent = async (eventName, handler) => {
            if (options.debug) console.log("on", eventName)
            if (eventName === EVENT_NAMES.request) {
                this.provider = handler
            } else {
                throw new Error("Unsupported event name " + eventName)
            }
        }
        const innerSend: LX.SendEvent = async (eventName, data: any) => {
            if (options.debug) console.log("send", eventName)
            if (this.isDestroyed) return
            switch (eventName) {
                case EVENT_NAMES.inited:
                    this.isInited = true
                    this.supportPlatform = data.sources
                    this.handlers.onInited?.(data)
                    break
                case EVENT_NAMES.updateAlert:
                    this.isUpdateNeeded = true
                    this.updateAlert = data
                    this.handlers.onUpdateAlert?.(data)
                    break
                default:
                    throw new Error("Unsupported event name " + eventName)
            }
        }
        const innerRrequest: LX.Request = options.debug
            ? (...args1) => request(
                args1[0], args1[1], 
                (...args2) => {
                    console.log("request", ...args1, ...args2)
                    args1[2](...args2)
                }
            )
            : request
        // const innerRrequest = request
        const innerLog = options.debug
            ? (...args: any) => {
                console.log("log", ...args)
                this.handlers.onLog?.(...args)
            } : this.handlers.onLog ?? (() => {})
        // const innerLog = handlers.onLog ?? (() => {})
        const lxApi: LX.API = {
            version: "2.0.0",
            env: "desktop",
            currentScriptInfo: scriptInfo,
            EVENT_NAMES,
            on: innerOn,
            send: innerSend,  
            request: innerRrequest,
            utils: createUtils()
        }
        const content: anyobject = {
            lx: lxApi,
            console: { log: innerLog },
            setTimeout: global.setTimeout,
            clearTimeout: global.clearTimeout,
            setInterval: global.setInterval,
            clearInterval: global.clearInterval
        }
        Object.setPrototypeOf(content, null)
        try {
            vm.runInNewContext(script, content, {
                // filename:
                // contextName:
                timeout: 10_000,
                contextCodeGeneration: {
                    strings: false,
                    wasm: false
                },
                importModuleDynamically() {
                    // if (options.debug) console.log("Unsupported dynamic import")
                    throw new Error("Unsupported dynamic import")
                }
            })
        } catch (error) {
            if (!this.isInited) {
                if (this.options.debug) console.log("initError", error)
                this.isInitError = true
                this.destroy()
                this.handlers.onInitError?.(error)
            } else {
                if (this.options.debug) console.log("runError", error)
                this.handlers.onRunError?.(error)
            }
        }
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
    }
}