import { LIP_ANCHORS, type LipPoint } from "../lipOil/deformGeometry";
import { createLipStabilizer } from "../lipOil/stabilizeLandmarks";
import { createImageAnchor, readMouthGray } from "../lipOil/imageAnchor";
/** One tracker per camera session. Head motion follows the current image;
 * only residual contour noise is filtered, without filtering position twice. */
export function createMobileLipTracker() {
    const lips = [...new Set([
        ...LIP_ANCHORS.upper.outer, ...LIP_ANCHORS.upper.inner,
        ...LIP_ANCHORS.lower.outer, ...LIP_ANCHORS.lower.inner,
    ])];
    const shape = createLipStabilizer();
    const anchor = createImageAnchor();
    return {
        update(ctx: CanvasRenderingContext2D, points: LipPoint[] | null, width: number, height: number, time: number) {
            if (!points)
                anchor.reset();
            const correction = points
                ? anchor.update(readMouthGray(ctx, points, width, height), points, width, height, time)
                : null;
            let imagePose = points;
            if (points && correction) {
                // Correct the detector's pose error before filtering shape.
                // Filtering already corrected coordinates prevents pose
                // correction from accumulating again through previous output.
                const center = lips.reduce((sum,i)=>({x:sum.x+points[i].x,y:sum.y+points[i].y}),{x:0,y:0});
                center.x/=lips.length;center.y/=lips.length;
                const a=1+(correction.scaleDelta??0),b=correction.rotationDelta??0;
                imagePose=points.map(p=>{
                    const x=(p.x-center.x)*width,y=(p.y-center.y)*height;
                    return {...p,x:center.x+(a*x-b*y)/width,y:center.y+(b*x+a*y)/height};
                });
            }
            return shape.update(imagePose, width, height, time, correction);
        },
        reset() { shape.reset(); anchor.reset(); },
    };
}
