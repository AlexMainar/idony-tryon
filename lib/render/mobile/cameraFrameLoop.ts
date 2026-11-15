type VideoFrames = {
    currentTime?: number;
    getVideoPlaybackQuality?: () => {
        totalVideoFrames: number;
    };
    requestVideoFrameCallback?: (callback: (time: number, metadata: {
        mediaTime: number;
    }) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
};
type FrameClock = {
    request: (callback: FrameRequestCallback) => number;
    cancel: (id: number) => void;
    now: () => number;
};
/** One pending frame for every product. Some WebKit versions expose video
 * callbacks but stop delivering them for an offscreen video. An animation
 * watchdog keeps the same-frame pipeline alive without queuing camera images. */
export function createCameraFrameLoop(options: {
    video: () => VideoFrames | null;
    frozen: () => boolean;
    draw: (mediaTimeMs?: number) => void;
    onError: (error: unknown) => void;
}, clock: FrameClock = {
    request: callback => requestAnimationFrame(callback),
    cancel: id => cancelAnimationFrame(id),
    now: () => performance.now(),
}) {
    let running = false, animationId: number | null = null, videoId: number | null = null;
    let pendingVideo: VideoFrames | null = null, generation = 0;
    let lastDecodedFrame = -1, lastMediaTime = -1;
    const cancel = () => {
        if (animationId !== null)
            clock.cancel(animationId);
        if (videoId !== null)
            pendingVideo?.cancelVideoFrameCallback?.(videoId);
        animationId = videoId = null;
        pendingVideo = null;
    };
    const schedule = () => {
        if (!running)
            return;
        const token = ++generation, started = clock.now(), video = options.video();
        const finish = (mediaTimeMs?: number) => {
            if (!running || token !== generation)
                return;
            ++generation;
            cancel();
            try {
                if (!options.frozen()) {
                    const decoded = video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
                    const time = typeof video?.currentTime === "number" ? video.currentTime * 1000 : mediaTimeMs;
                    // A watchdog and a late native callback can refer to the same image.
                    // Never advance lip tracking twice or switch its clock backwards.
                    if (decoded > 0 && decoded === lastDecodedFrame)
                        return;
                    if (decoded <= 0 && time !== undefined && time <= lastMediaTime)
                        return;
                    lastDecodedFrame = decoded;
                    if (time !== undefined)
                        lastMediaTime = time;
                    options.draw(time);
                }
                else
                    options.draw(mediaTimeMs);
            }
            catch (error) {
                options.onError(error);
            }
            finally {
                schedule();
            }
        };
        if (!options.frozen() && video?.requestVideoFrameCallback) {
            pendingVideo = video;
            videoId = video.requestVideoFrameCallback((_, metadata) => finish(metadata.mediaTime * 1000));
            const watch = () => {
                animationId = null;
                if (!running || token !== generation)
                    return;
                if (clock.now() - started >= 32) {
                    finish();
                    return;
                }
                animationId = clock.request(watch);
            };
            animationId = clock.request(watch);
        }
        else
            animationId = clock.request(() => { animationId = null; finish(); });
    };
    return {
        start() { if (running)
            return; running = true; lastDecodedFrame = lastMediaTime = -1; schedule(); },
        stop() { running = false; ++generation; cancel(); },
    };
}
