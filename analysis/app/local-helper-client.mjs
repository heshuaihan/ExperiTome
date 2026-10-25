// SPDX-License-Identifier: MIT

const POLL_INTERVAL_MS = 800;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

function abortError() {
  return new DOMException('本机任务已取消。', 'AbortError');
}

function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class LocalHelperClient {
  constructor({ pollIntervalMs = POLL_INTERVAL_MS, jobTimeoutMs = JOB_TIMEOUT_MS } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.jobTimeoutMs = jobTimeoutMs;
    this.capabilities = null;
    this.token = '';
    this.available = false;
  }

  get isLoopback() {
    return typeof window !== 'undefined' && isLoopbackHost(window.location.hostname);
  }

  supports(operation) {
    return Array.isArray(this.capabilities?.operations) && this.capabilities.operations.includes(operation);
  }

  async connect() {
    this.available = false;
    this.capabilities = null;
    this.token = '';
    if (!this.isLoopback) throw new Error('本机分析助手仅在本机页面中可用。');

    const response = await fetch('/api/capabilities', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await this.#readJson(response);
    if (!response.ok) throw new Error(data?.error || data?.message || `本机分析助手返回 HTTP ${response.status}。`);
    if (!data || typeof data.version !== 'string' || typeof data.token !== 'string' || !data.token) {
      throw new Error('本机分析助手未提供版本或访问凭据。');
    }
    if (!Array.isArray(data.operations)) throw new Error('本机分析助手未返回可用功能列表。');
    this.capabilities = data;
    this.token = data.token;
    this.available = true;
    return data;
  }

  async registerPath(path, signal) {
    this.#requireOperation('inspect');
    const normalizedPath = String(path ?? '').trim();
    if (!normalizedPath) throw new Error('请输入本机文件路径。');
    return this.#request('/api/files', { method: 'POST', body: { path: normalizedPath }, signal });
  }

  async pickFile() {
    this.#requireOperation('inspect');
    return this.#request('/api/pick-file', { method: 'POST', body: {} });
  }

  async runJobRequest(request, onProgress = () => {}, signal) {
    const action = String(request?.action ?? '');
    const operation = action === 'compare' ? 'compare' : action;
    this.#requireOperation(operation);
    return this.#runJob(request, onProgress, signal);
  }

  async importFile(fileId, options, onProgress = () => {}, signal) {
    return this.runJobRequest({ action: 'import', fileId, options }, onProgress, signal);
  }

  async queryTarget(fileId, target, options = {}, onProgress = () => {}, signal) {
    this.#requireOperation('target');
    return this.#runJob({ action: 'target', fileId, target: String(target ?? ''), options }, onProgress, signal);
  }

  async extractXic(fileId, precursor, points = 1500, onProgress = () => {}, signal) {
    this.#requireOperation('xic');
    return this.#runJob({ action: 'xic', fileId, precursor: String(precursor ?? ''), points }, onProgress, signal);
  }

  async cancelJob(jobId) {
    if (!jobId || !this.token) return;
    try {
      await this.#request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch {
      // The job may already have completed or the helper may have stopped.
    }
  }

  #requireOperation(operation) {
    if (!this.available || !this.token) throw new Error('本机分析助手未连接；请刷新连接状态。');
    if (!this.supports(operation)) throw new Error(`本机分析助手暂不支持此操作。`);
  }

  async #request(path, { method = 'GET', body, signal } = {}) {
    if (!this.token) throw new Error('本机分析助手连接凭据不可用。');
    const headers = { Accept: 'application/json', 'X-ExperiAnalysis-Token': this.token };
    const init = { method, headers, cache: 'no-store', signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(path, init);
    const data = await this.#readJson(response);
    if (!response.ok) throw new Error(data?.error || data?.message || `本机分析助手返回 HTTP ${response.status}。`);
    if (data?.error) throw new Error(String(data.error));
    return data;
  }

  async #runJob(payload, onProgress, signal) {
    if (signal?.aborted) throw abortError();
    const created = await this.#request('/api/jobs', { method: 'POST', body: payload, signal });
    const jobId = String(created?.id ?? created?.jobId ?? '');
    if (!jobId) throw new Error('本机分析助手未返回任务编号。');
    const deadline = Date.now() + this.jobTimeoutMs;
    const cancelOnAbort = () => { void this.cancelJob(jobId); };
    signal?.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw abortError();
        const job = await this.#request(`/api/jobs/${encodeURIComponent(jobId)}`, { signal });
        onProgress({ message: job?.message || `本机任务：${job?.status || '处理中'}`, progress: job?.progress });
        if (job?.status === 'complete') {
          if (job.result === undefined) throw new Error('本机分析助手任务完成，但未返回结果。');
          return job.result;
        }
        if (job?.status === 'failed') throw new Error(job.error || job.message || '本机分析助手任务失败。');
        if (job?.status === 'cancelled') throw abortError();
        if (!['queued', 'running'].includes(job?.status)) throw new Error(`本机分析助手返回未知任务状态：${job?.status ?? '空'}。`);
        await wait(this.pollIntervalMs, signal);
      }
      await this.cancelJob(jobId);
      throw new Error('本机任务超过 30 分钟；已请求取消。');
    } catch (error) {
      if (signal?.aborted) {
        await this.cancelJob(jobId);
        throw abortError();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
    }
  }

  async #readJson(response) {
    let data = null;
    try { data = await response.json(); }
    catch { data = null; }
    return data;
  }
}

const sharedLocalHelper = new LocalHelperClient();

export async function capabilities() {
  if (sharedLocalHelper.available) return sharedLocalHelper.capabilities;
  try { return await sharedLocalHelper.connect(); }
  catch { return null; }
}

export async function runLocalJob(request, onProgress = () => {}, signal) {
  if (!sharedLocalHelper.available) {
    const connected = await capabilities();
    if (!connected) throw new Error('本机分析助手未连接。');
  }
  return sharedLocalHelper.runJobRequest(request, onProgress, signal);
}
