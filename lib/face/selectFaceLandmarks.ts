type Point = {x:number;y:number;z?:number};
/** The lip detector allows two faces only to disable MediaPipe's own temporal
 * smoothing. Keep rendering one person, preserving identity across result order. */
export function selectFaceLandmarks<T extends Point>(faces: T[][], reference?: Point[] | null): T[] | null {
  if (!faces.length) return null;
  if (faces.length === 1) return faces[0];
  const ids = [1,33,263,61,291];
  if (reference && ids.every(i=>reference[i])) {
    return faces.reduce((best,points)=>{
      const error=(candidate:T[])=>ids.reduce((sum,i)=>sum+(candidate[i].x-reference[i].x)**2+(candidate[i].y-reference[i].y)**2,0);
      return error(points)<error(best)?points:best;
    });
  }
  const area=(points:T[])=>Math.abs((points[454].x-points[234].x)*(points[152].y-points[10].y));
  return faces.reduce((largest,points)=>area(points)>area(largest)?points:largest);
}
