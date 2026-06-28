# -*- coding: utf-8 -*-
"""限流器：搜索请求限流、网易云请求并发 Semaphore、最小轮询间隔。"""
import threading
import time
from collections import deque


class RateLimiter:
    """滑动窗口限流器：在 window 秒内最多 max_count 次请求。

    线程安全。超限时 deny() 返回 True。
    """
    def __init__(self, max_count, window):
        self.max_count = max_count
        self.window = window
        self._hits = deque()
        self._lock = threading.Lock()

    def deny(self):
        """调用并判断是否应拒绝。返回 True 表示超限。"""
        now = time.monotonic()
        with self._lock:
            cutoff = now - self.window
            while self._hits and self._hits[0] < cutoff:
                self._hits.popleft()
            if len(self._hits) >= self.max_count:
                return True
            self._hits.append(now)
            return False


class MinInterval:
    """最小间隔限制：强制两次调用间隔不少于 interval 秒。

    用于 QR 轮询（最低 1.5s）、网易云请求等。
    线程安全。
    """
    def __init__(self, interval):
        self.interval = interval
        self._last = 0.0
        self._lock = threading.Lock()

    def acquire(self):
        """阻塞直到满足最小间隔。"""
        with self._lock:
            now = time.monotonic()
            wait = self.interval - (now - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()


# 全局限流器实例
search_limiter = RateLimiter(max_count=8, window=10)  # 10秒最多8次搜索
qr_poll_min_interval = MinInterval(interval=1.5)       # QR 轮询最低 1.5s

# 网易云请求并发上限（避免打爆上游）
netease_semaphore = threading.Semaphore(4)

# 同时音频流数量上限
stream_semaphore = threading.Semaphore(6)
