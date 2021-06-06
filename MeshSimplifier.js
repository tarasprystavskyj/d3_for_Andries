import {
  BufferGeometry,
  BufferAttribute,
  // Geometry,
  Vector3
} from "/js/newthree.module.js";
import {Geometry} from "/three.module.js";
import * as CostWorker from "/Worker/simplify.worker.js";
// import * as CostWorker from './cost.worker';

import { getIndexedPositions } from "/Utils.js";
export class WebWorker {
  constructor(worker) {
    const blob = new Blob(["(" + worker.toString() + ")()"], {
      type: "text/javascript"
    });
    return new Worker(URL.createObjectURL(blob));
  }
}

/*
 *  @author Pawel Misiurski https://stackoverflow.com/users/696535/pawel
 *  @author zz85 / http://twitter.com/blurspline / http://www.lab4games.net/zz85/blog
 *  Simplification Geometry Modifier
 *    - based on code and technique
 *    - by Stan Melax in 1998
 *    - Progressive Mesh type Polygon Reduction Algorithm
 *    - http://www.melax.com/polychop/
 */
const FIELDS_NO = 30;
const FIELDS_OVERSIZE = 500;
const OVERSIZE_CONTAINER_CAPACITY = 10000;
let reqId = 0;
let totalAvailableWorkers = navigator.hardwareConcurrency;
const DISCARD_BELOW_VERTEX_COUNT = 400;

if (typeof SharedArrayBuffer === "undefined") {
  totalAvailableWorkers = 0;
}
const preloadedWorkers = [];

export function createWorkers() {
  for (let i = 0; i < totalAvailableWorkers; i++) {
    preloadedWorkers.push(new WebWorker(CostWorker.default));
    preloadedWorkers.forEach((w, index) => {
      w.free = true;
      w.id = index;
    });
  }
}
createWorkers();

export function killWorkers() {
  preloadedWorkers.forEach(w => w.terminate());
}

function discardSimpleGeometry(geometry) {
  if (geometry instanceof Geometry) {
    if (geometry.vertices.length < DISCARD_BELOW_VERTEX_COUNT) {
      return true;
    }
  } else
  if (geometry instanceof BufferGeometry) {
    if (geometry.attributes.position.count < DISCARD_BELOW_VERTEX_COUNT) {
      return geometry;
    }
  } else {
    throw new Error("Not supported geometry type");
  }
  return false;
}

export function meshSimplifier(
  geometry,
  percentage,
  preserveTexture = true,
  attempt = 0,
  resolveTop
) {
  return new Promise((resolve, reject) => {
    if (discardSimpleGeometry(geometry)) {
      return resolve(geometry);
    }

    preserveTexture =
      preserveTexture && geometry.attributes.uv && geometry.attributes.uv.count;

    // console.time('Mesh simplification');

    new Promise((resolve2, reject2) => {
      requestFreeWorkers(
        preloadedWorkers,
        geometry.attributes.position.count,
        resolve2
      );
    }).then(workers => {
      sendWorkToWorkers(
        workers,
        geometry,
        percentage,
        preserveTexture,
        geometry
      )
        .then(dataArrayViews => {
          const newGeo = createNewBufferGeometry(
            dataArrayViews.verticesView,
            dataArrayViews.facesView,
            dataArrayViews.faceNormalsView,
            dataArrayViews.facesUVsView,
            dataArrayViews.skinWeight,
            dataArrayViews.skinIndex,
            dataArrayViews.faceMaterialIndexView,
            preserveTexture,
            geometry
          );

          // for (let key in dataArrayViews) {
          //   delete dataArrayViews[key];
          // }
          return (resolveTop || resolve)(newGeo);
        })
        .catch(e => {
          if (attempt >= 3) {
            console.log("Simplifying error messages", e);
            console.error(
              "Error in simplifying. Returning original.",
              geometry.name
            );
            return (resolveTop || resolve)(geometry);
          }
          console.log("Simplifying error messages", e);
          console.error(
            "Error in simplifying. Retrying in 500ms, attempt",
            attempt,
            geometry.name
          );
          const attemptCount = attempt + 1;
          setTimeout(() => {
            meshSimplifier(
              geometry,
              percentage,
              (preserveTexture = true),
              attemptCount,
              resolveTop || resolve
            );
          }, 500);
        });
    });
  });
}

let reusingDataArrays = null;
let previousVertexCount = 0;
function createDataArrays(verexCount, faceCount, workersAmount) {
  if (
    workersAmount === totalAvailableWorkers &&
    reusingDataArrays !== null &&
    verexCount <= previousVertexCount
  ) {
    emptyOversizedContainerIndex(reusingDataArrays.facesView);
    emptyOversizedContainer(reusingDataArrays.specialCases);
    emptyOversizedContainerIndex(reusingDataArrays.specialCasesIndex);
    emptyOversizedContainer(reusingDataArrays.specialFaceCases);
    emptyOversizedContainerIndex(reusingDataArrays.specialFaceCasesIndex);

    // zeroFill(reusingDataArrays.neighbourCollapse);
    // zeroFill(reusingDataArrays.verticesView);
    // zeroFill(reusingDataArrays.faceNormalView);
    // zeroFill(reusingDataArrays.faceNormalsView);
    // zeroFill(reusingDataArrays.facesUVsView);
    // zeroFill(reusingDataArrays.costStore);
    // zeroFill(reusingDataArrays.costCountView);
    // zeroFill(reusingDataArrays.costTotalView);
    // zeroFill(reusingDataArrays.costMinView);
    // zeroFill(reusingDataArrays.neighbourCollapse);
    zeroFill(reusingDataArrays.vertexWorkStatus);
    zeroFill(reusingDataArrays.buildIndexStatus);
    // zeroFill(reusingDataArrays.faceMaterialIndexView);
    zeroFill(reusingDataArrays.vertexNeighboursView);
    zeroFill(reusingDataArrays.vertexFacesView);
    return reusingDataArrays;
  }

  previousVertexCount = verexCount;
  const SAB =
    typeof SharedArrayBuffer === "undefined" ? ArrayBuffer : SharedArrayBuffer;
  // const positions = geo.attributes.position.array;
  const verticesAB = new SAB(verexCount * 3 * 4);
  const facesAB = new SAB(faceCount * 3 * 4); // REMOVED additional * 3 because something is fucked and i don't want to mess up other 'depending on faceCount'
  const faceNormalsAB = new SAB(faceCount * 9 * 4); // 3 or 9 depending on faceCount
  const faceUVsAB = new SAB(faceCount * 6 * 4); // 2 or 6 depending on faceCount
  const costStoreAB = new SAB(verexCount * 4);
  const neighbourCollapseAB = new SAB(verexCount * 4);
  const faceMaterialIndexAB = new SAB(faceCount * 3 * 2);
  const vertexNeighboursAB = new SAB(verexCount * FIELDS_NO * 4);
  const vertexFacesAB = new SAB(verexCount * FIELDS_NO * 4);

  const verticesView = new Float32Array(verticesAB);
  const facesView = new Int32Array(facesAB);
  emptyOversizedContainerIndex(facesView);

  const faceNormalView = new Float32Array(new SAB(faceCount * 3 * 4)); // // 1 or 3 depends on faceCount
  const faceNormalsView = new Float32Array(faceNormalsAB);
  const facesUVsView = new Float32Array(faceUVsAB);
  const skinWeight = new Float32Array(new SAB(faceCount * 12 * 4));
  const skinIndex = new Float32Array(new SAB(faceCount * 12 * 4));
  const costStore = new Float32Array(costStoreAB);
  const costCountView = new Int16Array(new SAB(verexCount * 2));
  const costTotalView = new Float32Array(new SAB(verexCount * 4));
  const costMinView = new Float32Array(new SAB(verexCount * 4));
  const neighbourCollapse = new Int32Array(neighbourCollapseAB);
  const vertexWorkStatus = new Uint8Array(new SAB(verexCount));
  const buildIndexStatus = new Uint8Array(new SAB(workersAmount));
  const faceMaterialIndexView = new Uint8Array(faceMaterialIndexAB);

  // 10 elements, up to 9 neighbours per vertex + first number tells how many neighbours
  const vertexNeighboursView = new Uint32Array(vertexNeighboursAB);
  const vertexFacesView = new Uint32Array(vertexFacesAB);

  const specialCases = new Int32Array(
    new SAB(FIELDS_OVERSIZE * OVERSIZE_CONTAINER_CAPACITY * 4)
  );
  emptyOversizedContainer(specialCases);
  const specialCasesIndex = new Int32Array(new SAB(verexCount * 4));
  emptyOversizedContainerIndex(specialCasesIndex);
  const specialFaceCases = new Int32Array(
    new SAB(FIELDS_OVERSIZE * OVERSIZE_CONTAINER_CAPACITY * 4)
  );
  emptyOversizedContainer(specialFaceCases);
  const specialFaceCasesIndex = new Int32Array(new SAB(faceCount * 4));
  emptyOversizedContainerIndex(specialFaceCasesIndex);

  reusingDataArrays = {
    verticesView,
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    skinWeight,
    skinIndex,
    faceMaterialIndexView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases: specialCases,
    specialCasesIndex: specialCasesIndex,
    specialFaceCases: specialFaceCases,
    specialFaceCasesIndex: specialFaceCasesIndex,
    costStore,
    costCountView,
    costTotalView,
    costMinView,
    neighbourCollapse,
    vertexWorkStatus,
    buildIndexStatus
  };
  return reusingDataArrays;
}

function loadGeometryToDataArrays(geometry, workersAmount) {
  let dataArrays;
  if (geometry instanceof Geometry) {
    geometry.mergeVertices();

    // geometry.mergeVertices();
    dataArrays = createDataArrays(
      geometry.vertices.length,
      geometry.faces.length,
      workersAmount
    );
    loadGeometry(dataArrays, geometry);
  } else if (geometry instanceof BufferGeometry) {
    if (geometry.index) {
      // geometry = geometry.toNonIndexed();
    }
    const positionsCount = geometry.index
      ? geometry.attributes.position.count
      : geometry.attributes.position.count;
    const faceCount = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;

    dataArrays = createDataArrays(positionsCount, faceCount, workersAmount);
    loadBufferGeometry(dataArrays, geometry, workersAmount);
  } else {
    throw new Error("Not supported geometry type");
  }
  dataArrays.collapseQueue = new Uint32Array(150);
  return dataArrays;
}

function loadBufferGeometry(dataArrays, geometry) {
  const { index, positions } = getIndexedPositions(geometry, 4);
  const {
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    skinWeight,
    skinIndex,
    faceMaterialIndexView
  } = dataArrays;

  // const vCount = positions.length / 3;

  // TEMP: solution until faceView has correct smaller numer of faces
  emptyOversizedContainerIndex(facesView);
  facesView.set(index);
  dataArrays.verticesView = positions; // .set(positions);

  for (var i = 0; i < facesView.length / 3; i++) {
    const faceNormal = computeFaceNormal(i, facesView, dataArrays.verticesView);
    faceNormalView[i * 3] = faceNormal.x;
    faceNormalView[i * 3 + 1] = faceNormal.y;
    faceNormalView[i * 3 + 2] = faceNormal.z;
  }

  if (geometry.attributes.normal) {
    // faceNormalView.set(geometry.attributes.normal.array);
    faceNormalsView.set(geometry.attributes.normal.array);
  }

  if (geometry.attributes.uv) {
    facesUVsView.set(geometry.attributes.uv.array);
  }
  if (geometry.attributes.skinWeight) {
    skinWeight.set(geometry.attributes.skinWeight.array);
  }

  if (geometry.attributes.skinIndex) {
    skinIndex.set(geometry.attributes.skinIndex.array);
  }

  const fCount = index.length;
  if (geometry.groups && geometry.groups.length) {
    for (let i = 0; i < fCount; i++) {
      const grp = geometry.groups.find((group, ind) => {
        return group.start <= i && i < group.start + group.count;
      });
      faceMaterialIndexView[i / 3] = grp.materialIndex;
    }
  }
}

function loadGeometry(dataArrays, geometry) {
  const {
    verticesView,
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    faceMaterialIndexView
  } = dataArrays;
  for (let i = 0; i < geometry.vertices.length; i++) {
    verticesView[i * 3] = geometry.vertices[i].x;
    verticesView[i * 3 + 1] = geometry.vertices[i].y;
    verticesView[i * 3 + 2] = geometry.vertices[i].z;
  }

  const faces = geometry.faces;
  var faceUVs = geometry.faceVertexUvs[0];

  const doFaceUvs = !!faceUVs.length;
  for (let i = 0; i < faces.length; i++) {
    facesView[i * 3] = faces[i].a;
    facesView[i * 3 + 1] = faces[i].b;
    facesView[i * 3 + 2] = faces[i].c;

    faceNormalView[i * 3] = faces[i].normal.x;
    faceNormalView[i * 3 + 1] = faces[i].normal.y;
    faceNormalView[i * 3 + 2] = faces[i].normal.z;

    faceNormalsView[i * 9] = faces[i].vertexNormals[0].x;
    faceNormalsView[i * 9 + 1] = faces[i].vertexNormals[0].y;
    faceNormalsView[i * 9 + 2] = faces[i].vertexNormals[0].z;

    faceNormalsView[i * 9 + 3] = faces[i].vertexNormals[1].x;
    faceNormalsView[i * 9 + 4] = faces[i].vertexNormals[1].y;
    faceNormalsView[i * 9 + 5] = faces[i].vertexNormals[1].z;

    faceNormalsView[i * 9 + 6] = faces[i].vertexNormals[2].x;
    faceNormalsView[i * 9 + 7] = faces[i].vertexNormals[2].y;
    faceNormalsView[i * 9 + 8] = faces[i].vertexNormals[2].z;

    if (doFaceUvs) {
      facesUVsView[i * 6] = faceUVs[i][0].x;
      facesUVsView[i * 6 + 1] = faceUVs[i][0].y;
      facesUVsView[i * 6 + 2] = faceUVs[i][1].x;
      facesUVsView[i * 6 + 3] = faceUVs[i][1].y;
      facesUVsView[i * 6 + 4] = faceUVs[i][2].x;
      facesUVsView[i * 6 + 5] = faceUVs[i][2].y;
    }

    faceMaterialIndexView[i] = faces[i].materialIndex;
  }
}

function pushIfUnique(array, object) {
  if (array.indexOf(object) === -1) array.push(object);
}
function removeFromArray(array, object) {
  var k = array.indexOf(object);
  if (k > -1) array.splice(k, 1);
}

function getVertexOnFaceId(faceId, facesView, verticesView, index, target) {
  const vertexId = facesView[faceId * 3 + index];
  target.set(
    verticesView[vertexId * 3],
    verticesView[vertexId * 3 + 1],
    verticesView[vertexId * 3 + 2]
  );
}

// borrowed from geometry
var cb = new Vector3(),
  ab = new Vector3();
var v1Temp = new Vector3(),
  v2Temp = new Vector3();
function computeFaceNormal(faceId, facesView, verticesView) {
  getVertexOnFaceId(faceId, facesView, verticesView, 1, v1Temp);
  getVertexOnFaceId(faceId, facesView, verticesView, 2, v2Temp);

  cb.subVectors(v2Temp, v1Temp);

  getVertexOnFaceId(faceId, facesView, verticesView, 0, v2Temp);
  ab.subVectors(v2Temp, v1Temp);
  cb.cross(ab);
  cb.normalize();

  // do not pass around, this will mutate
  return cb;
}

function replaceVertex(
  faceId,
  oldvId,
  newvId,
  facesView,
  vertexFacesView,
  vertexNeighboursView,
  specialCases,
  specialFaceCases,
  dataArrayViews
) {
  // replace correct vertex in face index
  facesView[
    faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView)
  ] = newvId;

  removeFaceFromVertex(oldvId, faceId, vertexFacesView, specialFaceCases);
  setVertexFaceAtIndex(newvId, faceId, vertexFacesView, specialFaceCases);

  const v1 = facesView[faceId * 3];
  const v2 = facesView[faceId * 3 + 1];
  const v3 = facesView[faceId * 3 + 2];

  removeVertexIfNonNeighbor(
    oldvId,
    v1,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );

  removeVertexIfNonNeighbor(
    v1,
    oldvId,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );

  removeVertexIfNonNeighbor(
    oldvId,
    v2,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );
  removeVertexIfNonNeighbor(
    v2,
    oldvId,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );

  removeVertexIfNonNeighbor(
    oldvId,
    v3,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );
  removeVertexIfNonNeighbor(
    v3,
    oldvId,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialFaceCases,
    dataArrayViews
  );

  setVertexNeighboursAtIndex(v1, v2, vertexNeighboursView, specialCases);
  setVertexNeighboursAtIndex(v1, v3, vertexNeighboursView, specialCases);

  setVertexNeighboursAtIndex(v2, v1, vertexNeighboursView, specialCases);
  setVertexNeighboursAtIndex(v2, v3, vertexNeighboursView, specialCases);

  setVertexNeighboursAtIndex(v3, v1, vertexNeighboursView, specialCases);
  setVertexNeighboursAtIndex(v3, v2, vertexNeighboursView, specialCases);

  // computeNormal();
}

function getVertexNeighbours(vertexId, dataArrayViews, target) {
  const neighbors = target || [];
  let count = 0;
  for (var i = 0; i < dataArrayViews.facesView.length; i++) {
    if (dataArrayViews.facesView[i] === vertexId) {
      const faceVertexIndex = i % 3;
      const faceId = i - faceVertexIndex;

      for (var j = 0; j < 3; j++) {
        if (faceVertexIndex === j) continue;
        const vertexId = dataArrayViews.facesView[faceId];

        if (neighbors.indexOf(vertexId) === -1) {
          // neighbors.push(vertexId);
          count++;
          target[vertexId * FIELDS_NO] = count;
          target[vertexId * FIELDS_NO + count] = vertexId;
        }
      }
    }
  }
  return neighbors;
}

function removeVertexFromNeighbour(
  atIndex,
  neighbourIndex,
  target,
  specialCases
) {
  removeFieldFromSBWithOversize(atIndex, neighbourIndex, target, specialCases);
  removeFieldFromSBWithOversize(neighbourIndex, atIndex, target, specialCases);
}

function removeFromNeighboursIndex(atIndex, target, specialCases) {
  const index = atIndex * FIELDS_NO;
  let count = target[index];

  for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
    const neighbourId = target[index + i + 1];
    target[index + i + 1] = 0;
    removeFieldFromSBWithOversize(neighbourId, atIndex, target, specialCases);
  }

  if (count > FIELDS_NO - 1) {
    specialCases[index].forEach(neighbourId =>
      removeFieldFromSBWithOversize(neighbourId, atIndex, target, specialCases)
    );
  }

  target[index] = 0;
  specialCases[index] = [];
  return;
}
function removeFaceFromVertex(
  vertexId,
  faceId,
  vertexFacesView,
  specialFaceCases
) {
  return removeFieldFromSBWithOversize(
    vertexId,
    faceId,
    vertexFacesView,
    specialFaceCases
  );
}

function removeVertexIfNonNeighbor(
  vertexId,
  neighbourId,
  facesView,
  vertexFacesView,
  vertexNeighboursView,
  specialCases,
  specialFaceCases,
  dataArrayViews
) {
  // location both for facesView and vertexNeighboursView
  const locationIndex = vertexId * FIELDS_NO;
  const count = vertexFacesView[locationIndex];

  for (var i = 0; i < count; i++) {
    const faceId = getFaceIdByVertexAndIndex(vertexId, i, dataArrayViews);
    if (faceIdHasVertexId(faceId, neighbourId, facesView)) return;
  }

  removeVertexFromNeighbour(
    vertexId,
    neighbourId,
    vertexNeighboursView,
    specialCases
  );
}

function setVertexNeighboursAtIndex(
  atIndex,
  neighbourIndex,
  target,
  specialCases,
  specialCasesIndex
) {
  addToSBWithOversize(
    atIndex,
    neighbourIndex,
    target,
    specialCases,
    specialCasesIndex
  );
}

function setVertexFaceAtIndex(
  atIndex,
  faceIndex,
  target,
  specialFaceCases,
  specialFaceCasesIndex
) {
  addToSBWithOversize(
    atIndex,
    faceIndex,
    target,
    specialFaceCases,
    specialFaceCasesIndex
  );
}

function buildVertexNeighboursIndex(
  facesView,
  target,
  vertexFacesView,
  specialCases,
  specialCasesIndex,
  specialFaceCases,
  specialFaceCasesIndex,
  from,
  to
) {
  // each face takes 3 fields a. b. c vertices ids
  for (var i = from; i < to; i += 3) {
    const faceId = i / 3;
    setVertexNeighboursAtIndex(
      facesView[i],
      facesView[i + 1],
      target,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      facesView[i],
      facesView[i + 2],
      target,
      specialCases,
      specialCasesIndex
    );

    setVertexNeighboursAtIndex(
      facesView[i + 1],
      facesView[i],
      target,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      facesView[i + 1],
      facesView[i + 2],
      target,
      specialCases,
      specialCasesIndex
    );

    setVertexNeighboursAtIndex(
      facesView[i + 2],
      facesView[i],
      target,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      facesView[i + 2],
      facesView[i + 1],
      target,
      specialCases,
      specialCasesIndex
    );

    setVertexFaceAtIndex(
      facesView[i],
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );
    setVertexFaceAtIndex(
      facesView[i + 1],
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );
    setVertexFaceAtIndex(
      facesView[i + 2],
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );
  }
}

export function computeLeastCosts(dataArrayViews, fromIndex, toIndex) {
  // compute all edge collapse costs
  for (let i = fromIndex; i < toIndex; i++) {
    computeEdgeCostAtVertex(i, dataArrayViews);
  }

  buildFullIndex(
    dataArrayViews.costStore,
    dataArrayViews.collapseQueue,
    fromIndex,
    toIndex
  );
}

export function computeEdgeCostAtVertex(vId, dataArrayViews) {
  // compute the edge collapse cost for all edges that start
  // from vertex v.  Since we are only interested in reducing
  // the object by selecting the min cost edge at each step, we
  // only cache the cost of the least cost edge at this vertex
  // (in member variable collapse) as well as the value of the
  // cost (in member variable collapseCost).

  const neighboursView = dataArrayViews.vertexNeighboursView;
  const count = neighboursView[vId * FIELDS_NO];

  if (count === 0) {
    // collapse if no neighbors.
    dataArrayViews.neighbourCollapse[vId] = -1;
    dataArrayViews.costStore[vId] = 0;

    return;
  }

  dataArrayViews.costStore[vId] = 100000;
  dataArrayViews.neighbourCollapse[vId] = -1;

  // search all neighboring edges for 'least cost' edge
  for (var i = 0; i < count; i++) {
    const nextNeighbourId = getVertexNeighbourByIndex(vId, i, dataArrayViews);

    var collapseCost = tryComputeEdgeCollapseCost(
      vId,
      nextNeighbourId,
      dataArrayViews
    );

    if (dataArrayViews.neighbourCollapse[vId] === -1) {
      dataArrayViews.neighbourCollapse[vId] = nextNeighbourId;
      dataArrayViews.costStore[vId] = collapseCost;
      dataArrayViews.costMinView[vId] = collapseCost;
      dataArrayViews.costTotalView[vId] = 0;
      dataArrayViews.costCountView[vId] = 0;
    }

    dataArrayViews.costCountView[vId]++;
    dataArrayViews.costTotalView[vId] += collapseCost;
    if (collapseCost < dataArrayViews.costMinView[vId]) {
      dataArrayViews.neighbourCollapse[vId] = nextNeighbourId;
      dataArrayViews.costMinView[vId] = collapseCost;
    }
  }

  const cost =
    dataArrayViews.costTotalView[vId] / dataArrayViews.costCountView[vId];

  // we average the cost of collapsing at this vertex
  dataArrayViews.costStore[vId] = cost;
}

function faceIdHasVertexId(faceId, vertexId, facesView) {
  if (facesView[faceId * 3] === vertexId) return true;
  if (facesView[faceId * 3 + 1] === vertexId) return true;
  if (facesView[faceId * 3 + 2] === vertexId) return true;

  return false;
}

const posA = new Vector3();
const posB = new Vector3();

function tryComputeEdgeCollapseCost(uId, vId, dataArrayViews) {
  try {
    return computeEdgeCollapseCost(uId, vId, dataArrayViews);
  } catch (e) {
    console.log(
      "Vertex neighbourhood data overwritten by another thread. Retrying"
    );
    return tryComputeEdgeCollapseCost(uId, vId, dataArrayViews);
  }
}
function computeEdgeCollapseCost(uId, vId, dataArrayViews) {
  // if we collapse edge uv by moving u to v then how
  // much different will the model change, i.e. the 'error'.
  posA.set(
    dataArrayViews.verticesView[vId * 3],
    dataArrayViews.verticesView[vId * 3 + 1],
    dataArrayViews.verticesView[vId * 3 + 2]
  );
  posB.set(
    dataArrayViews.verticesView[uId * 3],
    dataArrayViews.verticesView[uId * 3 + 1],
    dataArrayViews.verticesView[uId * 3 + 2]
  );
  var edgelengthSquared = posA.distanceToSquared(posB);

  var curvature = 0;

  var sideFaces = [];

  var vertexFaceCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];

  var i,
    il = vertexFaceCount,
    face,
    sideFace;

  // find the 'sides' triangles that are on the edge uv
  for (i = 0; i < il; i++) {
    var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

    if (faceIdHasVertexId(faceId, vId, dataArrayViews.facesView)) {
      sideFaces.push(faceId);
    }
  }

  var faceNormal = new Vector3();
  var sideFaceNormal = new Vector3();

  // use the triangle facing most away from the sides
  // to determine our curvature term
  for (i = 0; i < il; i++) {
    var minCurvature = 1;
    var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

    for (var j = 0; j < sideFaces.length; j++) {
      var sideFaceId = sideFaces[j];
      sideFaceNormal.set(
        dataArrayViews.faceNormalView[sideFaceId * 3],
        dataArrayViews.faceNormalView[sideFaceId * 3 + 1],
        dataArrayViews.faceNormalView[sideFaceId * 3 + 2]
      );
      faceNormal.set(
        dataArrayViews.faceNormalView[faceId * 3],
        dataArrayViews.faceNormalView[faceId * 3 + 1],
        dataArrayViews.faceNormalView[faceId * 3 + 2]
      );

      // use dot product of face normals.
      var dotProd = faceNormal.dot(sideFaceNormal);
      minCurvature = Math.min(minCurvature, (1.001 - dotProd) * 0.5);
    }
    curvature = Math.max(curvature, minCurvature);
  }

  // crude approach in attempt to preserve borders
  // though it seems not to be totally correct
  var borders = 0;
  if (sideFaces.length < 2) {
    // we add some arbitrary cost for borders,
    //borders += 1;
    curvature += 10;
  }

  var costUV = computeUVsCost(uId, vId, dataArrayViews);

  var amt =
    edgelengthSquared * curvature * curvature +
    borders * borders +
    costUV * costUV;

  return amt;
}

function getFromBigData(
  parentId,
  childId,
  storage,
  oversizeStorage,
  oversizeStorageIndex
) {
  // childId is 0 indexed!
  const childIndex = childId + 1;
  const index = parentId * FIELDS_NO + childIndex;
  if (childIndex <= FIELDS_NO - 1) {
    return storage[index];
  } else {
    const index = oversizeStorageIndex[parentId];
    const offset = index * FIELDS_OVERSIZE;
    return oversizeStorage[offset + childIndex];
  }
}

function getVertexNeighbourByIndex(vId, neighbourIndex, dataArrayViews) {
  return getFromBigData(
    vId,
    neighbourIndex,
    dataArrayViews.vertexNeighboursView,
    dataArrayViews.specialCases,
    dataArrayViews.specialCasesIndex
  );
}

function getFaceIdByVertexAndIndex(vId, i, dataArrayViews) {
  return getFromBigData(
    vId,
    i,
    dataArrayViews.vertexFacesView,
    dataArrayViews.specialFaceCases,
    dataArrayViews.specialFaceCasesIndex
  );
}

// check if there are multiple texture coordinates at U and V vertices(finding texture borders)
function computeUVsCost(uId, vId, dataArrayViews) {
  // if (!u.faces[0].faceVertexUvs || !u.faces[0].faceVertexUvs) return 0;
  // if (!v.faces[0].faceVertexUvs || !v.faces[0].faceVertexUvs) return 0;
  var UVsAroundVertex = [];
  var UVcost = 0;

  // uncomment when ready
  let oversize = false;
  let facesCount = dataArrayViews.vertexFacesView[vId * FIELDS_NO];
  if (facesCount > FIELDS_NO - 1) {
    facesCount = FIELDS_NO - 1;
    oversize = true;
  }

  for (var i = facesCount - 1; i >= 0; i--) {
    var fid = getFaceIdByVertexAndIndex(vId, i, dataArrayViews);
    if (faceIdHasVertexId(fid, uId, dataArrayViews.facesView)) {
      UVsAroundVertex.push(getUVsOnVertexId(fid, vId, dataArrayViews));
    }
  }
  if (oversize) {
    dataArrayViews.specialFaceCases[vId * FIELDS_NO].forEach(fid => {
      if (faceIdHasVertexId(fid, uId, dataArrayViews.facesView)) {
        UVsAroundVertex.push(getUVsOnVertexId(fid, vId, dataArrayViews));
      }
    });
  }

  UVsAroundVertex.reduce((prev, uv) => {
    if (prev.x && (prev.x !== uv.x || prev.y !== uv.y)) {
      UVcost += 1;
    }
    return uv;
  }, {});

  UVsAroundVertex.length = 0;

  const facesCount2 = dataArrayViews.vertexFacesView[uId * FIELDS_NO];
  // check if all coordinates around U have the same value
  for (i = facesCount2 - 1; i >= 0; i--) {
    let fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

    if (fid2 === undefined) {
      debugger;
      fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
    }
    if (faceIdHasVertexId(fid2, vId, dataArrayViews.facesView))
      UVsAroundVertex.push(getUVsOnVertexId(fid2, uId, dataArrayViews));
  }
  UVsAroundVertex.reduce((prev, uv) => {
    if (prev.x && (prev.x !== uv.x || prev.y !== uv.y)) {
      UVcost += 1;
    }
    return uv;
  }, {});
  return UVcost;
}

function removeVertex(vId, dataArrayViews) {
  // console.assert(v.faces.length === 0);

  removeFromNeighboursIndex(
    vId,
    dataArrayViews.vertexNeighboursView,
    dataArrayViews.specialCases
  );
}

function removeFace(fid, dataArrayViews) {
  const v1 = dataArrayViews.facesView[fid * 3];
  const v2 = dataArrayViews.facesView[fid * 3 + 1];
  const v3 = dataArrayViews.facesView[fid * 3 + 2];

  dataArrayViews.facesView[fid * 3] = -1;
  dataArrayViews.facesView[fid * 3 + 1] = -1;
  dataArrayViews.facesView[fid * 3 + 2] = -1;

  // if (f.v1) removeFromArray(f.v1.faces, f);
  // if (f.v2) removeFromArray(f.v2.faces, f);
  // if (f.v3) removeFromArray(f.v3.faces, f);

  removeFaceFromVertex(
    v1,
    fid,
    dataArrayViews.vertexFacesView,
    dataArrayViews.specialFaceCases
  );
  removeFaceFromVertex(
    v2,
    fid,
    dataArrayViews.vertexFacesView,
    dataArrayViews.specialFaceCases
  );
  removeFaceFromVertex(
    v3,
    fid,
    dataArrayViews.vertexFacesView,
    dataArrayViews.specialFaceCases
  );

  // TODO optimize this!
  var vs = [v1, v2, v3];
  var v1a, v2a;

  for (var i = 0; i < 3; i++) {
    v1a = vs[i];
    v2a = vs[(i + 1) % 3];

    if ((!v1a && v1a !== 0) || !v2a !== 0) continue;
    // v1.removeIfNonNeighbor(v2, dataArrayViews.facesView);
    // v2.removeIfNonNeighbor(v1, dataArrayViews.facesView);
    removeVertexIfNonNeighbor(
      v1a,
      v2a,
      dataArrayViews.facesView,
      dataArrayViews.vertexFacesView,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialFaceCases,
      dataArrayViews
    );
    removeVertexIfNonNeighbor(
      v2a,
      v1a,
      dataArrayViews.facesView,
      dataArrayViews.vertexFacesView,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialFaceCases,
      dataArrayViews
    );
  }
}

var moveToThisNormalValues = [new Vector3(), new Vector3(), new Vector3()];
function collapse(uId, vId, preserveTexture, dataArrayViews) {
  if (vId === null) {
    // u is a vertex all by itself so just delete it..
    removeVertex(uId, dataArrayViews);
    return true;
  }

  const neighboursView = dataArrayViews.vertexNeighboursView;
  const neighboursCountV = neighboursView[vId * FIELDS_NO];
  const neighboursCountU = neighboursView[uId * FIELDS_NO];

  var i;
  var tmpVertices = [];

  for (i = 0; i < neighboursCountU; i++) {
    pushIfUnique(
      tmpVertices,
      getVertexNeighbourByIndex(uId, i, dataArrayViews)
    );
  }

  for (i = 0; i < neighboursCountV; i++) {
    pushIfUnique(
      tmpVertices,
      getVertexNeighbourByIndex(vId, i, dataArrayViews)
    );
  }

  let UVx = 0;
  let UVy = 0;

  let facesCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];

  // delete triangles on edge uv:
  for (i = facesCount - 1; i >= 0; i--) {
    const faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
    if (faceIdHasVertexId(faceId, vId, dataArrayViews.facesView)) {
      if (preserveTexture) {
        // get uvs on remaining vertex
        UVx =
          dataArrayViews.facesUVsView[
            faceId * 6 +
              getVertexIndexOnFaceId(faceId, vId, dataArrayViews.facesView) * 2
          ];
        UVy =
          dataArrayViews.facesUVsView[
            faceId * 6 +
              getVertexIndexOnFaceId(faceId, vId, dataArrayViews.facesView) *
                2 +
              1
          ];
      }
      // if (u.faces[i].normal) {
      var middleGroundNormal = getPointInBetweenByPerc(
        getNormalsOnVertexId(faceId, uId, dataArrayViews),
        getNormalsOnVertexId(faceId, vId, dataArrayViews),
        0.5
      );
      moveToThisNormalValues[0] = middleGroundNormal;
      // }

      removeFace(faceId, dataArrayViews);
    }
  }

  facesCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];
  if (preserveTexture && facesCount) {
    for (i = facesCount - 1; i >= 0; i--) {
      var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, uId, dataArrayViews.facesView) * 2
      ] = UVx;

      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, uId, dataArrayViews.facesView) * 2 +
          1
      ] = UVy;

      //var faceVerticeUVsgetNormalsOnVertex(face, u);
      // var faceVerticeNormals = getNormalsOnVertexId(face, u);
      // faceVerticeNormals.copy(moveToThisNormalValues[0]);

      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, uId, dataArrayViews.facesView) * 3
      ] = moveToThisNormalValues[0].x;
      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, uId, dataArrayViews.facesView) * 3 +
          1
      ] = moveToThisNormalValues[0].y;
      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, uId, dataArrayViews.facesView) * 3 +
          2
      ] = moveToThisNormalValues[0].z;
    }
  }

  // update remaining triangles to have v instead of u
  for (i = facesCount - 1; i >= 0; i--) {
    replaceVertex(
      getFaceIdByVertexAndIndex(uId, i, dataArrayViews),
      uId,
      vId,
      dataArrayViews.facesView,
      dataArrayViews.vertexFacesView,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialFaceCases,
      dataArrayViews
    );
  }
  removeVertex(uId, dataArrayViews);
  // recompute the edge collapse costs in neighborhood
  for (i = 0; i < tmpVertices.length; i++) {
    // uncomment when ready
    computeEdgeCostAtVertex(tmpVertices[i], dataArrayViews);
  }
  return true;
}

function getPointInBetweenByPerc(pointA, pointB, percentage) {
  var dir = new Vector3().copy(pointB).sub(pointA);
  var len = dir.length();
  dir = dir.normalize().multiplyScalar(len * percentage);
  return dir.add(pointA);
}

function getUVsOnVertexId(faceId, vertexId, dataArrayViews) {
  return {
    x:
      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) * 2
      ],
    y:
      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
            2 +
          1
      ]
  };
}
function getNormalsOnVertexId(faceId, vertexId, dataArrayViews) {
  //return face.vertexNormals[getVertexIndexOnFaceId(faceId, vertexId)];
  return {
    x:
      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) * 3
      ],
    y:
      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
            3 +
          1
      ],
    z:
      dataArrayViews.faceNormalsView[
        faceId * 9 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
            3 +
          2
      ]
  };
}

function getVertexIndexOnFaceId(faceId, vertexId, facesView) {
  if (vertexId === facesView[faceId * 3]) return 0;
  if (vertexId === facesView[faceId * 3 + 1]) return 1;
  if (vertexId === facesView[faceId * 3 + 2]) return 2;

  throw new Error("Vertex not found " + vertexId);
}

function requestFreeWorkers(workers, verticesLength, onWorkersReady) {
  // at least 2000 vertices per worker, limit amount of workers
  const availableWorkersAmount = workers.length;
  const minVerticesPerWorker = 4000;
  let maxWorkers = Math.max(
    1,
    Math.round(verticesLength / minVerticesPerWorker)
  );
  const workersAmount = Math.min(
    Math.min(workers.filter(w => w.free).length, maxWorkers),
    availableWorkersAmount
  );

  console.log("requesting workers", workersAmount, workersAmount);

  // wait for at least 2
  if (workersAmount < 1) {
    setTimeout(() => {
      requestFreeWorkers(workers, verticesLength, onWorkersReady);
    }, 200);
    return;
  }
  const reservedWorkers = workers.filter(w => w.free).slice(0, workersAmount);
  reservedWorkers.forEach(w => (w.free = false));
  onWorkersReady(reservedWorkers);
}

function sendWorkToWorkers(
  workers,
  bGeometry,
  percentage,
  preserveTexture,
  geometry
) {
  return new Promise((resolve, reject) => {
    const dataArrays = loadGeometryToDataArrays(geometry, workers.length);

    // this should not be done before instantiating workers
    // but it's needed because specialCases and specialFaceCases are using copying instead of SABs
    if (typeof SharedArrayBuffer === "undefined") {
      buildVertexNeighboursIndex(
        dataArrays.facesView,
        dataArrays.vertexNeighboursView,
        dataArrays.vertexFacesView,
        dataArrays.specialCases,
        dataArrays.specialCasesIndex,
        dataArrays.specialFaceCases,
        dataArrays.specialFaceCasesIndex,
        0,
        dataArrays.facesView.length / 3
      );
    }
    // console.log(
    //   'Using',
    //   maxWorkers,
    //   'out of',
    //   workersAmount,
    //   'available workers(at least',
    //   minVerticesPerWorker,
    //   'vertices per worker)'
    // );

    reqId++;

    workers.forEach((w, i) => {
      if (w.free) {
        throw new Error("the worker should be reserved now");
      }
      w.postMessage({
        task: "load",
        id: w.id,
        workerIndex: i,
        totalWorkers: workers.length,
        verticesView: dataArrays.verticesView,
        facesView: dataArrays.facesView,
        faceNormalView: dataArrays.faceNormalView,
        faceNormalsView: dataArrays.faceNormalsView,
        facesUVsView: dataArrays.facesUVsView,
        skinWeight: dataArrays.skinWeight,
        skinIndex: dataArrays.skinIndex,
        costStore: dataArrays.costStore,
        faceMaterialIndexView: dataArrays.faceMaterialIndexView,
        vertexFacesView: dataArrays.vertexFacesView,
        vertexNeighboursView: dataArrays.vertexNeighboursView,
        costCountView: dataArrays.costCountView,
        costTotalView: dataArrays.costTotalView,
        costMinView: dataArrays.costMinView,
        neighbourCollapse: dataArrays.neighbourCollapse,
        vertexWorkStatus: dataArrays.vertexWorkStatus,
        buildIndexStatus: dataArrays.buildIndexStatus,
        specialCases: dataArrays.specialCases,
        specialCasesIndex: dataArrays.specialCasesIndex,
        specialFaceCases: dataArrays.specialFaceCases,
        specialFaceCasesIndex: dataArrays.specialFaceCasesIndex,

        // no shared buffers below but structural copying
        percentage,
        preserveTexture,
        FIELDS_NO,
        FIELDS_OVERSIZE,
        OVERSIZE_CONTAINER_CAPACITY,
        reqId
      });
      w.onDone = doneLoading.bind(null, reqId);
      w.addEventListener("message", w.onDone);
    });

    let doneCount = 0;
    let aborting = false;
    let errorMessages = [];
    function doneLoading(jobId, event) {
      if (event.data.reqId !== jobId) {
        // throw new Error('wrong job id');
        console.log("wrong job id");
        return;
      }
      const w = event.currentTarget;
      w.removeEventListener("message", w.onDone);
      w.free = true;

      doneCount++;

      if (event.data.task === "simplificationError") {
        errorMessages.push(event.data.message);
        aborting = true;
      } else if (
        event.data.task === "edgesCostsDone" &&
        doneCount >= workers.length
      ) {
        resolve(dataArrays);
      }

      if (doneCount >= workers.length && aborting) {
        reject(errorMessages);
      }
    }
  });
}

function createNewBufferGeometry(
  vertices,
  faces,
  normalsView,
  uvsView,
  skinWeight,
  skinIndex,
  faceMaterialIndexView,
  preserveTexture,
  geometry
) {
  const geo = new BufferGeometry();
  geo.name = geometry.name;
  let faceCount = 0;
  for (var i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;
    faceCount++;
  }
  console.log("Faces reduction from : ", faces.length / 3, "to", faceCount);
  var positions = new Float32Array(faceCount * 9); // faces * 3 vertices * vector3
  var normals = new Float32Array(faceCount * 9);
  var uvs = new Float32Array(faceCount * 6);

  let count = 0;

  let vertexIndex = 0;
  let normalIndex = 0;
  let uvIndex = 0;
  let materialIndex = null;
  let materialCount = 0;

  if (geometry.index) {
    const attributes = [
      {
        name: "position",
        array: vertices,
        itemSize: 3
      },
      {
        name: "normal",
        array: normalsView,
        itemSize: 3
      },
      {
        name: "uv",
        array: uvsView,
        itemSize: 2
      },
      {
        name: "skinWeight",
        array: skinWeight,
        itemSize: 4
      },
      {
        name: "skinIndex",
        array: skinIndex,
        itemSize: 4
      }
    ];
    attributes.forEach(attrib => {
      const bufferAttribute = new Float32Array(faceCount * 3 * attrib.itemSize);
      count = 0;
      for (i = 0; i < faces.length / 3; i++) {
        if (faces[i * 3] === -1) continue;
        // for each vertex
        for (var vId = 0; vId < 3; vId++) {
          let offset = faces[i * 3 + vId] * attrib.itemSize;
          // for entire itemSize
          for (var j = 0, jl = attrib.itemSize; j < jl; j++) {
            const index = vId * attrib.itemSize + j;

            bufferAttribute[count * 3 * attrib.itemSize + index] =
              attrib.array[offset + j];
          }
        }
        count++;
      }
      geo.addAttribute(
        attrib.name,
        new BufferAttribute(bufferAttribute, attrib.itemSize)
      );
    });
  }

  for (i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;

    if (!geometry.index) {
      // face a vertex
      vertexIndex = faces[i * 3] * 3;
      positions[count * 9] = vertices[vertexIndex];
      positions[count * 9 + 1] = vertices[vertexIndex + 1];
      positions[count * 9 + 2] = vertices[vertexIndex + 2];

      // face b vertex
      vertexIndex = faces[i * 3 + 1] * 3;
      positions[count * 9 + 3] = vertices[vertexIndex];
      positions[count * 9 + 4] = vertices[vertexIndex + 1];
      positions[count * 9 + 5] = vertices[vertexIndex + 2];

      // face c vertex
      vertexIndex = faces[i * 3 + 2] * 3;
      positions[count * 9 + 6] = vertices[vertexIndex];
      positions[count * 9 + 7] = vertices[vertexIndex + 1];
      positions[count * 9 + 8] = vertices[vertexIndex + 2];

      // 1 normal per face
      normalIndex = i * 9;
      normals[count * 9] = normalsView[normalIndex];
      normals[count * 9 + 1] = normalsView[normalIndex + 1];
      normals[count * 9 + 2] = normalsView[normalIndex + 2];

      normals[count * 9 + 3] = normalsView[normalIndex + 3];
      normals[count * 9 + 4] = normalsView[normalIndex + 4];
      normals[count * 9 + 5] = normalsView[normalIndex + 5];

      normals[count * 9 + 6] = normalsView[normalIndex + 6];
      normals[count * 9 + 7] = normalsView[normalIndex + 7];
      normals[count * 9 + 8] = normalsView[normalIndex + 8];

      // uvs
      uvIndex = i * 6;
      uvs[count * 6] = uvsView[uvIndex];
      uvs[count * 6 + 1] = uvsView[uvIndex + 1];

      uvs[count * 6 + 2] = uvsView[uvIndex + 2];
      uvs[count * 6 + 3] = uvsView[uvIndex + 3];

      uvs[count * 6 + 4] = uvsView[uvIndex + 4];
      uvs[count * 6 + 5] = uvsView[uvIndex + 5];
    }

    // // material Index
    if (faceMaterialIndexView[i] !== materialIndex) {
      materialIndex = faceMaterialIndexView[i];
      let previousGroup;

      if (geo.groups.length) {
        previousGroup = geo.groups[geo.groups.length - 1];
        previousGroup.count = materialCount * 3;
      }
      geo.groups.push({
        start: count * 3,
        count: 0,
        materialIndex: materialIndex
      });

      materialCount = 1;
    } else {
      materialCount++;
    }

    count++;
  }

  // close last material group
  if (geo.groups.length) {
    const previousGroup = geo.groups[geo.groups.length - 1];
    console.log(
      previousGroup.start + previousGroup.count,
      "vs",
      positions.length / 3
    );
    if (previousGroup.start + previousGroup.count < positions.length / 3) {
      console.log("Material range missing. Adding");
      previousGroup.count = positions.length / 3 - previousGroup.start;
    } else {
      previousGroup.count = materialCount * 3;
    }
  }

  if (!geometry.index) {
    geo.addAttribute("position", new BufferAttribute(positions, 3));

    if (normals.length > 0) {
      geo.addAttribute("normal", new BufferAttribute(normals, 3));
    }

    if (uvs.length > 0) {
      geo.addAttribute("uv", new BufferAttribute(uvs, 2));
    }
  }

  console.log("Result mesh sizes:");
  console.log("positions", positions.length);
  console.log("normals", normals.length);
  console.log("uv", uvs.length);

  // console.timeEnd('Mesh simplification');
  // if (typeof SharedArrayBuffer === 'undefined') {
  //   // simulate worker
  //   const totalWorkers = 1;
  //   const workerIndex = 1;
  //   const range = Math.floor(geometry.attributes.position.count / totalWorkers);
  //   const start = range * workerIndex;
  //   const end = start + range;

  //   computeLeastCosts(dataArrays, 0, geometry.attributes.position.count);
  //   collapseLeastCostEdges(
  //     undefined,
  //     undefined,
  //     percentage,
  //     dataArrays,
  //     undefined,
  //     preserveTexture,
  //     start,
  //     end
  //   );
  //   return;
  // }
  // console.log('before:', geometry.faces.length);
  // console.log('after:', newGeo.faces.length);
  // console.log(
  //   'savings:',
  //   100 - (100 / geometry.faces.length) * newGeo.faces.length,
  //   '%'
  // );
  return geo;
}

function collapseLeastCostEdges(
  vertices,
  faces,
  percentage,
  dataArrayViews,
  neighbourCollapse,
  preserveTexture,
  from,
  to
) {
  // 1. get available workers (with mesh loaded)
  // 2. split the work between them up to vertices.length
  // 3. send a task computeEdgesCost(fromIndex, toIndex)
  // 4. when all return (with correct mesh id) proceed with collapsing
  const originalLength = to - from; // vertices.length;
  var nextVertexId;
  var howManyToRemove = Math.round(originalLength * percentage);
  var z = howManyToRemove;
  var skip = 0;

  // const costsOrdered = new Float32Array(vertices.length);

  // for (var i = from; i < to; i++) {
  //   // costs[i] = vertices[i].collapseCost;
  //   costsOrdered[i] = costStore[i]; // vertices[i].collapseCost;
  // }

  // costsOrdered.sort();

  // let current = 0;
  // function getNext() {
  //   const vertex = vertices[costStore.indexOf(costsOrdered[current])];
  //   console.log(vertex && vertex.id);

  //   current++;

  //   if (!vertex) {
  //     return getNext();
  //   }
  //   return vertex;
  // }

  // const collapsedArr = [];
  let collapsedCount = 0;

  while (z--) {
    // nextVertexId = minimumCostEdge(vertices, skip, from, to, dataArrayViews);
    nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
    if (nextVertexId === false) {
      buildFullIndex(
        dataArrayViews.costStore,
        dataArrayViews.collapseQueue,
        from,
        to
      );
      nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
    }
    if (dataArrayViews.vertexWorkStatus[nextVertexId] === 1) {
      console.log("work on this one going. skipping");
      continue;
    }
    if (dataArrayViews.vertexWorkStatus[nextVertexId] === 2) {
      // console.log('this one was already removed');
      continue;
    }
    //if (collapsedArr.includes(nextVertexId)) {
    // console.log('WTF');
    //}
    //collapsedArr.push(nextVertexId);
    collapsedCount++;

    if (!nextVertexId) {
      console.log("no next vertex");
      break;
    }

    if (nextVertexId < from || nextVertexId >= to) {
      console.log("skipping: ", nextVertexId);
      skip++;
      continue;
    }
    const neighbourId = dataArrayViews.neighbourCollapse[nextVertexId];
    if (dataArrayViews.vertexWorkStatus[neighbourId] === 1) {
      console.log("work on collapse neighbour going. skipping");
      continue;
    }
    if (dataArrayViews.vertexWorkStatus[neighbourId] === 2) {
      console.log("this neighbour was already removed");
      continue;
    }

    var collapsed = collapse(
      nextVertexId,
      neighbourId,
      preserveTexture,
      dataArrayViews
    );

    if (!collapsed) {
      console.log("not collapsed");
      skip++;
    }

    // TEMO: this kind of fixes but breaks everything
    // looks what's happening in CONSOLE.ASSERT
    dataArrayViews.costStore[nextVertexId] = 9999;
  }
  // console.log(
  //   'Worker index in job',
  //   workerIndex,
  //   'Worker ID in global pool',
  //   dataArrayViews.id,
  //   ' removed ',
  //   collapsedCount,
  //   ' / ',
  //   dataArrayViews.verticesView.length / 3
  // );
}

function minimumCostEdge(vertices, skip, from, to, dataArrayViews) {
  // O(n * n) approach. TODO optimize this
  var leastV = from + skip;
  // var leastV = from + skip;

  if (leastV === null) {
    skip++;
    return minimumCostEdge(vertices, skip, from, to, dataArrayViews);
  }
  // var v;

  if (from + skip >= to) {
    return false;
  }

  for (var i = from; i < to; i++) {
    if (i < from || i >= to - 1) {
      continue;
    }
    // v = vertices[i];
    // if (!v) continue;

    if (dataArrayViews.costStore[i] < dataArrayViews.costStore[leastV]) {
      leastV = i;
    }
  }

  return leastV;
}

const EMPTY_QUEUE_VALUE = 99999;
let costsOrderedIndexes;

function buildFullIndex(valuesArr, orderingArr, fromIndex, toIndex) {
  costsOrderedIndexes =
    costsOrderedIndexes && costsOrderedIndexes.length === toIndex - fromIndex
      ? costsOrderedIndexes
      : new Uint32Array(toIndex - fromIndex);

  for (var i = fromIndex; i < toIndex; i++) {
    costsOrderedIndexes[i - fromIndex] = i;
  }

  // sort indexes
  costsOrderedIndexes.sort((a, b) =>
    valuesArr[a] < valuesArr[b] ? -1 : (valuesArr[b] < valuesArr[a]) | 0
  );

  for (i = 0; i < orderingArr.length; i++) {
    if (i === 0) {
      orderingArr[0] = 1;
      continue;
    }
    orderingArr[i] = costsOrderedIndexes[i - 1];
  }
}

/**@abstract returns next value
 * 0 - first element is the current value
 * taken value is replaced by EMPTY_QUEUE_VALUE (99999)
 */
function takeNextValue(orderingArr) {
  if (orderingArr[0] === orderingArr.length) {
    for (var i = 1; i < orderingArr.length; i++) {
      if (orderingArr[i] !== EMPTY_QUEUE_VALUE) {
        const value = orderingArr[i];
        orderingArr[i] = EMPTY_QUEUE_VALUE;
        orderingArr[0] = i + 1;
        return value;
      }
    }
    return false; // when no non-empty entries
  }

  for (i = orderingArr[0]; i < orderingArr.length; i++) {
    if (orderingArr[i] !== EMPTY_QUEUE_VALUE) {
      const value = orderingArr[i];
      orderingArr[i] = EMPTY_QUEUE_VALUE;
      orderingArr[0] = i + 1;
      return value;
    }
  }
  orderingArr[0] = orderingArr.length; // this will restart using wrapping to begginning
  return takeNextValue(orderingArr);
}

// taken from Geometry.mergeVertices to merge positions in buffer geometry
function mergeBGVertices(attributes, targetPositions, targetFaces, targetUVs) {
  var verticesMap = {}; // Hashmap for looking up vertices by position coordinates (and making sure they are unique)
  var unique = [],
    changes = [];

  var vX, vY, vZ, key;
  var precisionPoints = 4; // number of decimal points, e.g. 4 for epsilon of 0.0001
  var precision = Math.pow(10, precisionPoints);
  var i, il, face;
  var indices, j, jl;

  var uniquePositions = 0;

  for (i = 0, il = attributes.position.count; i < il; i++) {
    vX = attributes.position.array[i * 3];
    vY = attributes.position.array[i * 3 + 1];
    vZ = attributes.position.array[i * 3 + 2];
    key =
      Math.round(vX * precision) +
      "_" +
      Math.round(vY * precision) +
      "_" +
      Math.round(vZ * precision);

    if (verticesMap[key] === undefined) {
      verticesMap[key] = i;
      // unique.push(this.vertices[i]);
      targetPositions[uniquePositions * 3] = vX;
      targetPositions[uniquePositions * 3 + 1] = vY;
      targetPositions[uniquePositions * 3 + 2] = vZ;

      changes[i] = vX; // unique.length - 1;
    } else {
      //console.log('Duplicate vertex found. ', i, ' could be using ', verticesMap[key]);
      changes[i] = changes[verticesMap[key]];
    }
  }

  // faces do not exists in buffergeometry
  // if faces are completely degenerate after merging vertices, we
  // have to remove them from the geometry.
  var faceIndicesToRemove = [];

  for (i = 0, il = this.faces.length; i < il; i++) {
    face = this.faces[i];

    face.a = changes[face.a];
    face.b = changes[face.b];
    face.c = changes[face.c];

    indices = [face.a, face.b, face.c];

    // if any duplicate vertices are found in a Face3
    // we have to remove the face as nothing can be saved
    for (var n = 0; n < 3; n++) {
      if (indices[n] === indices[(n + 1) % 3]) {
        faceIndicesToRemove.push(i);
        break;
      }
    }
  }

  for (i = faceIndicesToRemove.length - 1; i >= 0; i--) {
    var idx = faceIndicesToRemove[i];

    this.faces.splice(idx, 1);

    for (j = 0, jl = this.faceVertexUvs.length; j < jl; j++) {
      this.faceVertexUvs[j].splice(idx, 1);
    }
  }

  // Use unique set of vertices

  var diff = this.vertices.length - unique.length;
  this.vertices = unique;
  return diff;
}

// BELOW FLAT ARRAYS MANAGER

function addToSBWithOversize(
  atIndex,
  childIndex,
  target,
  oversizeContainer,
  oversizeContainerIndex
) {
  const index = atIndex * FIELDS_NO;
  let count = target[index];
  if (count === 0) {
    count++;
    target[index] = count;
    target[index + count] = childIndex;
    return;
  }

  for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
    if (target[index + i + 1] === childIndex) {
      return;
    }
  }

  let oversize = false;
  if (count >= FIELDS_NO - 1) {
    oversize = true;
  }

  if (
    oversize &&
    !addToOversizeContainer(
      oversizeContainer,
      oversizeContainerIndex,
      atIndex,
      childIndex,
      count === FIELDS_NO - 1
    )
  ) {
    return;
  }

  count++;
  target[index] = count;
  if (!oversize) {
    target[index + count] = childIndex;
  }
}

function removeFieldFromSBWithOversize(
  indexId,
  elementToRemove,
  sbContainer,
  oversizeContainer,
  oversizeContainerIndex
) {
  let index = indexId * FIELDS_NO;
  let count = sbContainer[index];
  let oversize = false;

  if (count === 0) {
    console.log("Cannot remove from empty element");
    return;
  }
  if (count > FIELDS_NO - 1) {
    oversize = true;
  }
  let found = false;

  if (oversize) {
    const indexOf = oversizedIncludes(
      oversizeContainer,
      oversizeContainerIndex,
      indexId,
      elementToRemove
    );
    if (indexOf !== -1) {
      removeFromOversizeContainer(
        oversizeContainer,
        oversizeContainerIndex,
        indexId,
        elementToRemove
      );
      found = true;
    }
  }

  // if not found in versized find in regular
  if (!found) {
    for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
      if (!found && sbContainer[index + i + 1] === elementToRemove) {
        found = true;
      }
      if (found) {
        // overwrite and reindexing remaining
        // if it fits in regular non-oversized storage
        if (i <= FIELDS_NO - 3) {
          // maximum allow to copy from field 19 - i + 2
          // so skip this field if i >= FIELDS_NO - 3 (17)
          sbContainer[index + i + 1] = sbContainer[index + i + 2];
        } else if (oversize) {
          // only one elements needs to be popped
          const poppedEl = popOversizedContainer(
            oversizeContainer,
            oversizeContainerIndex,
            indexId
          );
          sbContainer[index + i + 1] = poppedEl;
        } else {
          // this scenario is only valid on elements with exactly 19 elements
          if (i + 1 !== FIELDS_NO - 1) {
            console.error(
              "this looks like an error. Too many field but no oversize?"
            );
          }
        }
      }
    }
  }

  if (found && count > 0) {
    sbContainer[index] = count - 1;
  }
  if (!found) {
    console.log("Cannot remove not existing element", indexId, elementToRemove);
  }
  return;
}

function addToOversizeContainer(
  container,
  containerIndex,
  parentIndex,
  childIndex,
  reset = false
) {
  const index = getIndexInOversized(containerIndex, parentIndex);
  if (index === -1 || reset) {
    // console.log('making new oversized for value ', childIndex);
    const newIndex = findFirstFreeZoneInOversizeContainer(container);
    // console.log('new space found', newIndex);
    containerIndex[parentIndex] = newIndex;
    container[newIndex * FIELDS_OVERSIZE] = 1; // new amount of elements at this index (-1 means unused)
    container[newIndex * FIELDS_OVERSIZE + 1] = childIndex;
    return true;
  }

  const childIndexInOversized = oversizedIncludes(
    container,
    containerIndex,
    parentIndex,
    childIndex
  );
  if (childIndexInOversized !== -1) {
    // console.log('already found', parentIndex, childIndex);
    return false;
  } else {
    let length = container[index * FIELDS_OVERSIZE];
    if (length >= FIELDS_OVERSIZE - 1) {
      console.log("END IS HERE!");
      throw new Error("Ran out of oversized container capacity");
    }
    length++;
    container[index * FIELDS_OVERSIZE] = length;
    container[index * FIELDS_OVERSIZE + length] = childIndex;
    // console.log(
    //   'setting at',
    //   index * FIELDS_OVERSIZE + length,
    //   ' value ',
    //   childIndex
    // );
    return true;
  }
}

function emptyOversizedContainer(container) {
  for (var i = 0; i < OVERSIZE_CONTAINER_CAPACITY; i++) {
    container[i * FIELDS_OVERSIZE] = -1;
  }
}

function emptyOversizedContainerIndex(containerIndex) {
  for (var i = 0; i < containerIndex.length; i++) {
    containerIndex[i] = -1;
  }
}

function zeroFill(arr) {
  for (var i = 0; i < arr.length; i++) {
    arr[i] = 0;
  }
}

function getIndexInOversized(containerIndex, parentIndex) {
  if (containerIndex[parentIndex] === undefined) {
    throw new Error("Oversize container index is too small");
  }
  return containerIndex[parentIndex];
}

function findFirstFreeZoneInOversizeContainer(oversizeContainer) {
  for (var i = 0; i < OVERSIZE_CONTAINER_CAPACITY; i++) {
    if (oversizeContainer[i * FIELDS_OVERSIZE] === -1) {
      return i;
    }
  }
  throw new Error("Ran out of space for oversized elements");
}

function removeFromOversizeContainer(
  oversizeContainer,
  oversizeContainerIndex,
  parentIndex,
  childIndex
) {
  const indexInOversized = getIndexInOversized(
    oversizeContainerIndex,
    parentIndex
  );
  const offset = indexInOversized * FIELDS_OVERSIZE;
  let length = oversizeContainer[offset];
  const childIndexInOversized = oversizedIncludes(
    oversizeContainer,
    oversizeContainerIndex,
    parentIndex,
    childIndex
  );
  if (childIndexInOversized === -1) {
    throw new Error("Element is not present in oversized container");
  }

  // console.log('removing', oversizeContainer[offset + childIndexInOversized]);

  // shift the remaining
  const start = offset + childIndexInOversized;
  const end = offset + length;
  for (var i = start; i < end; i++) {
    oversizeContainer[i] = oversizeContainer[i + 1];
  }
  // set rightmost element to -1
  oversizeContainer[end] = -1;

  length--;
  oversizeContainer[offset] = length; // update length

  // if this is the last element delete the whole thing
  if (length === 0) {
    removeOversizedContainer(
      oversizeContainer,
      oversizeContainerIndex,
      parentIndex
    );
    return;
  }
}

function oversizedIncludes(container, containerIndex, parentIndex, childIndex) {
  const index = getIndexInOversized(containerIndex, parentIndex);
  const offset = index * FIELDS_OVERSIZE;
  const length = container[offset];
  //     if (length < 1) {
  //       throw new Error('empty value should be -1');
  //     }
  // console.log('checking if includes', parentIndex, childIndex, length);
  for (var i = 0; i <= length; i++) {
    if (container[offset + i] === childIndex) {
      // console.log('found at', index + i);
      return i;
    }
  }
  return -1;
}

function removeOversizedContainer(
  oversizeContainer,
  oversizeContainerIndex,
  index
) {
  const indexInOversized = oversizeContainerIndex[index];
  const offset = indexInOversized * FIELDS_OVERSIZE;
  const length = oversizeContainer[offset];
  if (length > 0) {
    console.log("removing non empty oversized container", length);
  }
  oversizeContainer[offset] = -1;
  oversizeContainerIndex[index] = -1;
}

function popOversizedContainer(
  oversizeContainer,
  oversizeContainerIndex,
  index
) {
  const indexInOversized = getIndexInOversized(oversizeContainerIndex, index);
  const offset = indexInOversized * FIELDS_OVERSIZE;
  let length = oversizeContainer[offset];
  const poppedElement = oversizeContainer[offset + length];

  oversizeContainer[offset + length] = -1; // clear popped element
  length--;
  oversizeContainer[offset] = length; // update length
  if (length === 0) {
    // if reducing from 1 this is last element
    removeOversizedContainer(oversizeContainer, oversizeContainerIndex, index);
  }
  return poppedElement;
}

// FLAT ARRAY MANAGER ENDS HERE

export default meshSimplifier;
