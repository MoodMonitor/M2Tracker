class WorkerService {
    private static instance: WorkerService;
    private readonly _worker: Worker;

    private constructor() {
        this._worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    }

    get worker(): Worker {
        return this._worker;
    }

    public static getInstance(): WorkerService {
        if (!WorkerService.instance) {
            WorkerService.instance = new WorkerService();
        }
        return WorkerService.instance;
    }
}

export const workerService = WorkerService.getInstance();