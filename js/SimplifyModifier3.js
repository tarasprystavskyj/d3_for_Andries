import {
  Color,
  BufferGeometry,
  BufferAttribute,
  Face3,
  Geometry,
  Vector2,
  Vector3
} from "/js/three4.module.js";
import WebWorker from "/js/workerSetup.js";
import * as CostWorker from "/js/cost.worker.js";

/*
 *  @author zz85 / http://twitter.com/blurspline / http://www.lab4games.net/zz85/blog
 *  @author Pawel Misiurski - UVs collapse cost and preservation https://stackoverflow.com/users/696535/pawel
 *  Simplification Geometry Modifier
 *    - based on code and technique
 *    - by Stan Melax in 1998
 *    - Progressive Mesh type Polygon Reduction Algorithm
 *    - http://www.melax.com/polychop/
 */

let globalVertexView;
let globalFacesView;
var globalGeometry;

var cb = new Vector3(),
  ab = new Vector3();

function pushIfUnique(array, object) {
  if (array.indexOf(object) === -1) array.push(object);
}

function removeFromArray(array, object) {
  var k = array.indexOf(object);
  if (k > -1) array.splice(k, 1);
}
// we use a triangle class to represent structure of face slightly differently
function Triangle(v1, v2, v3, a, b, c, fvuv, normal, fvn, materialIndex, id) {
  this.a = a;
  this.b = b;
  this.c = c;

  this.v1 = v1;
  this.v2 = v2;
  this.v3 = v3;

  this.id = id;

  this.normal = normal;
  this.faceVertexUvs = fvuv;
  this.vertexNormals = fvn;
  this.materialIndex = materialIndex;

  this.computeNormal();

  v1.faces.push(this);
  v1.addUniqueNeighbor(v2);
  v1.addUniqueNeighbor(v3);

  v2.faces.push(this);
  v2.addUniqueNeighbor(v1);
  v2.addUniqueNeighbor(v3);

  v3.faces.push(this);
  v3.addUniqueNeighbor(v1);
  v3.addUniqueNeighbor(v2);
}

Triangle.prototype.computeNormal = function() {
  // no need to compute normal because it can be obtained from geometry
  // in case it's needed again and it's not availale from normal it can be calculated by averaging this.vertexNormals
  // var vA = this.v1.position;
  // var vB = this.v2.position;
  // var vC = this.v3.position;
  // cb.subVectors(vC, vB);
  // ab.subVectors(vA, vB);
  // cb.cross(ab).normalize();
  // this.normal.copy(cb);
};

Triangle.prototype.hasVertex = function(v) {
  return v === this.v1 || v === this.v2 || v === this.v3;
};

Triangle.prototype.replaceVertex = function(oldv, newv) {
  let abcIndex = 0;

  if (oldv === this.v1) {
    this.a = newv.id;
    this.v1 = newv;
    abcIndex = 0;
  } else if (oldv === this.v2) {
    this.b = newv.id;
    this.v2 = newv;
    abcIndex = 1;
  } else if (oldv === this.v3) {
    this.c = newv.id;
    this.v3 = newv;
    abcIndex = 2;
  }

  globalFacesView[this.id * 3 + abcIndex] = newv.id;

  removeFromArray(oldv.faces, this);
  newv.faces.push(this);

  oldv.removeIfNonNeighbor(this.v1);
  this.v1.removeIfNonNeighbor(oldv);

  oldv.removeIfNonNeighbor(this.v2);
  this.v2.removeIfNonNeighbor(oldv);

  oldv.removeIfNonNeighbor(this.v3);
  this.v3.removeIfNonNeighbor(oldv);

  this.v1.addUniqueNeighbor(this.v2);
  this.v1.addUniqueNeighbor(this.v3);

  this.v2.addUniqueNeighbor(this.v1);
  this.v2.addUniqueNeighbor(this.v3);

  this.v3.addUniqueNeighbor(this.v1);
  this.v3.addUniqueNeighbor(this.v2);

  this.computeNormal();
};

function Vertex(v, id) {
  this.position = v;

  this.id = id; // old index id

  this.faces = []; // faces vertex is connected
  this.neighbors = []; // neighbouring vertices aka "adjacentVertices"

  // these will be computed in computeEdgeCostAtVertex()
  this.collapseCost = 0; // cost of collapsing this vertex, the less the better. aka objdist
  this.collapseNeighbor = null; // best candinate for collapsing
}

Vertex.prototype.addUniqueNeighbor = function(vertex) {
  pushIfUnique(this.neighbors, vertex);
};

Vertex.prototype.removeIfNonNeighbor = function(n) {
  var neighbors = this.neighbors;
  var faces = this.faces;

  var offset = neighbors.indexOf(n);
  if (offset === -1) return;
  for (var i = 0; i < faces.length; i++) {
    if (faces[i].hasVertex(n)) return;
  }

  neighbors.splice(offset, 1);
};

function prepareSimpleDataStructures(
  vertices,
  faces,
  faceUVs,
  oldVertices,
  oldFaces,
  oldFaceUVs,
  preserveTexture
) {
  // add vertices
  for (let i = 0, il = oldVertices.length; i < il; i++) {
    vertices[i] = new Vertex(oldVertices[i], i);
  }

  if (preserveTexture && oldFaceUVs.length) {
    // add UVs
    for (let i = 0; i < oldFaceUVs.length; i++) {
      const faceUV = oldFaceUVs[i];

      faceUVs.push([
        new Vector2(faceUV[0].x, faceUV[0].y),
        new Vector2(faceUV[1].x, faceUV[1].y),
        new Vector2(faceUV[2].x, faceUV[2].y)
      ]);
    }
  }

  // add faces
  for (let i = 0, il = oldFaces.length; i < il; i++) {
    const face = oldFaces[i];
    faces[i] = new Triangle(
      vertices[face.a],
      vertices[face.b],
      vertices[face.c],
      face.a,
      face.b,
      face.c,
      faceUVs[i],
      face.normal,
      face.vertexNormals.map(el => el.clone()),
      face.materialIndex,
      i
    );
  }
}

export function computeLeastCosts(vertices, fromIndex, toIndex) {
  // compute all edge collapse costs
  for (let i = fromIndex; i < toIndex; i++) {
    computeEdgeCostAtVertex(vertices[i]);
  }
} //

export function computeEdgeCostAtVertex(v) {
  // compute the edge collapse cost for all edges that start
  // from vertex v.  Since we are only interested in reducing
  // the object by selecting the min cost edge at each step, we
  // only cache the cost of the least cost edge at this vertex
  // (in member variable collapse) as well as the value of the
  // cost (in member variable collapseCost).

  if (v.neighbors.length === 0) {
    // collapse if no neighbors.
    v.collapseNeighbor = null;
    v.collapseCost = -0.01;

    return;
  }

  v.collapseCost = 100000;
  v.collapseNeighbor = null;

  // search all neighboring edges for "least cost" edge
  for (var i = 0; i < v.neighbors.length; i++) {
    var collapseCost = computeEdgeCollapseCost(v, v.neighbors[i]);

    if (!v.collapseNeighbor) {
      v.collapseNeighbor = v.neighbors[i];
      v.collapseCost = collapseCost;
      v.minCost = collapseCost;
      v.totalCost = 0;
      v.costCount = 0;
    }

    v.costCount++;
    v.totalCost += collapseCost;

    if (collapseCost < v.minCost) {
      v.collapseNeighbor = v.neighbors[i];
      v.minCost = collapseCost;
    }
  }

  // we average the cost of collapsing at this vertex
  v.collapseCost = v.totalCost / v.costCount;
  // v.collapseCost = v.minCost;
}

function computeEdgeCollapseCost(u, v) {
  // if we collapse edge uv by moving u to v then how
  // much different will the model change, i.e. the "error".

  var edgelengthSquared = v.position.distanceToSquared(u.position);
  var curvature = 0;

  var sideFaces = [];
  var i,
    il = u.faces.length,
    face,
    sideFace;

  // find the "sides" triangles that are on the edge uv
  for (i = 0; i < il; i++) {
    face = u.faces[i];

    if (face.hasVertex(v)) {
      sideFaces.push(face);
    }
  }

  // use the triangle facing most away from the sides
  // to determine our curvature term
  for (i = 0; i < il; i++) {
    var minCurvature = 1;
    face = u.faces[i];

    for (var j = 0; j < sideFaces.length; j++) {
      sideFace = sideFaces[j];
      // use dot product of face normals.
      var dotProd = face.normal.dot(sideFace.normal);
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

  var costUV = computeUVsCost(u, v);

  var amt =
    edgelengthSquared * curvature * curvature +
    borders * borders +
    costUV * costUV;

  return amt;
}

// check if there are multiple texture coordinates at U and V vertices(finding texture borders)
function computeUVsCost(u, v) {
  if (!u.faces[0].faceVertexUvs || !u.faces[0].faceVertexUvs) return 0;
  if (!v.faces[0].faceVertexUvs || !v.faces[0].faceVertexUvs) return 0;
  var UVsAroundVertex = [];
  var UVcost = 0;
  // check if all coordinates around V have the same value
  for (var i = v.faces.length - 1; i >= 0; i--) {
    var f = v.faces[i];
    if (f.hasVertex(u)) UVsAroundVertex.push(getUVsOnVertex(f, v));
  }
  UVsAroundVertex.reduce((prev, uv) => {
    if (prev.x && (prev.x !== uv.x || prev.y !== uv.y)) {
      UVcost += 1;
    }
    return uv;
  }, {});

  UVsAroundVertex.length = 0;
  // check if all coordinates around U have the same value
  for (i = u.faces.length - 1; i >= 0; i--) {
    var f = u.faces[i];
    if (f.hasVertex(v)) UVsAroundVertex.push(getUVsOnVertex(f, u));
  }
  UVsAroundVertex.reduce((prev, uv) => {
    if (prev.x && (prev.x !== uv.x || prev.y !== uv.y)) {
      UVcost += 1;
    }
    return uv;
  }, {});
  return UVcost;
}

function removeVertex(v, vertices) {
  console.assert(v.faces.length === 0);

  while (v.neighbors.length) {
    var n = v.neighbors.pop();
    removeFromArray(n.neighbors, v);
  }

  vertices[v.id] = null;
  // removeFromArray(vertices, v);
}

function removeFace(f, faces) {
  removeFromArray(faces, f);

  if (f.v1) removeFromArray(f.v1.faces, f);
  if (f.v2) removeFromArray(f.v2.faces, f);
  if (f.v3) removeFromArray(f.v3.faces, f);

  // TODO optimize this!
  var vs = [f.v1, f.v2, f.v3];
  var v1, v2;

  for (var i = 0; i < 3; i++) {
    v1 = vs[i];
    v2 = vs[(i + 1) % 3];

    if (!v1 || !v2) continue;
    v1.removeIfNonNeighbor(v2);
    v2.removeIfNonNeighbor(v1);
  }

  globalFacesView[f.id * 3] = -1;
  globalFacesView[f.id * 3 + 1] = -1;
  globalFacesView[f.id * 3 + 2] = -1;
}

var moveToThisUvsValues = [];
var moveToThisNormalValues = [new Vector3(), new Vector3(), new Vector3()];
var moveToThisNormal = new Vector3();
function collapse(vertices, faces, u, v, preserveTexture) {
  // u and v are pointers to vertices of an edge
  // Collapse the edge uv by moving vertex u onto v

  if (!v) {
    // u is a vertex all by itself so just delete it..
    removeVertex(u, vertices);
    return true;
  }

  var i;
  var tmpVertices = [];

  for (i = 0; i < u.neighbors.length; i++) {
    tmpVertices.push(u.neighbors[i]);
  }

  for (i = 0; i < v.neighbors.length; i++) {
    tmpVertices.push(v.neighbors[i]);
  }

  // delete triangles on edge uv:
  for (i = u.faces.length - 1; i >= 0; i--) {
    if (u.faces[i].hasVertex(v)) {
      if (preserveTexture && u.faces[i].faceVertexUvs) {
        // get uvs on remaining vertex
        moveToThisUvsValues = getUVsOnVertex(u.faces[i], v);
      }
      if (u.faces[i].normal) {
        var middleGroundNormal = getPointInBetweenByPerc(
          getNormalsOnVertex(u.faces[i], u),
          getNormalsOnVertex(u.faces[i], v),
          0.5
        );
        moveToThisNormalValues[0] = middleGroundNormal;
        // get normals on remaining vertex
        // moveToThisNormal.copy(u.faces[i].normal);
      }
      removeFace(u.faces[i], faces);
    }
  }

  if (preserveTexture && u.faces.length && u.faces[0].faceVertexUvs) {
    for (i = u.faces.length - 1; i >= 0; i--) {
      var face = u.faces[i];
      var faceVerticeUVs = getUVsOnVertex(face, u);
      faceVerticeUVs.copy(moveToThisUvsValues);

      //var faceVerticeUVsgetNormalsOnVertex(face, u);
      var faceVerticeNormals = getNormalsOnVertex(face, u);
      faceVerticeNormals.copy(moveToThisNormalValues[0]);
      // face.normal.copy(moveToThisNormal);
      // var perc = 0.2;
      // face.vertexNormals[0].copy(getPointInBetweenByPerc(face.vertexNormals[0], moveToThisNormalValues[0], perc));
    }
  }

  // update remaining triangles to have v instead of u
  for (i = u.faces.length - 1; i >= 0; i--) {
    u.faces[i].replaceVertex(u, v);
  }

  // v.position = getPointInBetweenByPerc(u.position, v.position, 0.9);

  removeVertex(u, vertices);
  // recompute the edge collapse costs in neighborhood
  for (i = 0; i < tmpVertices.length; i++) {
    computeEdgeCostAtVertex(tmpVertices[i]);
  }

  return true;
}

function getPointInBetweenByPerc(pointA, pointB, percentage) {
  var dir = pointB.clone().sub(pointA);
  var len = dir.length();
  dir = dir.normalize().multiplyScalar(len * percentage);
  return pointA.clone().add(dir);
}

function getUVsOnVertex(face, vertex) {
  return face.faceVertexUvs[getVertexIndexOnFace(face, vertex)];
}
function getNormalsOnVertex(face, vertex) {
  return face.vertexNormals[getVertexIndexOnFace(face, vertex)];
}

function getVertexIndexOnFace(face, vertex) {
  // var index = [face.v1, face.v2, face.v3].indexOf(vertex);
  if (vertex === face.v1) return 0;
  if (vertex === face.v2) return 1;
  if (vertex === face.v3) return 2;

  throw new Error("Vertex not found");
  // return index;
}

/**
 * modify - will reduce vertices and faces count
 * mergeVertices might be needed prior
 * @param count int how many vertices to remove ie. 60% removal Math.round(geo.vertices.count * 0.6)
 **/

const lowerLimit = 51;

export function createFaceMakerForBufferGeometry(geometry) {
  var tempNormals = [];
  var tempUVs = [];
  var tempUVs2 = [];
  var normals =
    geometry.attributes.normal !== undefined
      ? geometry.attributes.normal.array
      : undefined;
  var uvs =
    geometry.attributes.uv !== undefined
      ? geometry.attributes.uv.array
      : undefined;
  var uvs2 =
    geometry.attributes.uv2 !== undefined
      ? geometry.attributes.uv2.array
      : undefined;

  var colors = [];
  var faces = [];
  var faceVertexUvs = [];
  var vertices = [];

  if (uvs2 !== undefined) faceVertexUvs[1] = [];

  var positions = geometry.attributes.position.array;

  for (var i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    vertices.push(
      new Vector3(positions[i], positions[i + 1], positions[i + 2])
    );

    if (normals !== undefined) {
      tempNormals.push(new Vector3(normals[i], normals[i + 1], normals[i + 2]));
    }

    if (colors !== undefined) {
      colors.push(new Color(colors[i], colors[i + 1], colors[i + 2]));
    }

    if (uvs !== undefined) {
      tempUVs.push(new Vector2(uvs[j], uvs[j + 1]));
    }

    if (uvs2 !== undefined) {
      tempUVs2.push(new Vector2(uvs2[j], uvs2[j + 1]));
    }
  }

  function addFace(a, b, c, materialIndex) {
    var vertexNormals =
      normals !== undefined
        ? [
            tempNormals[a].clone(),
            tempNormals[b].clone(),
            tempNormals[c].clone()
          ]
        : [];
    var vertexColors =
      colors !== undefined
        ? [colors[a].clone(), colors[b].clone(), colors[c].clone()]
        : [];

    var face = new Face3(a, b, c, vertexNormals, vertexColors, materialIndex);

    faces.push(face);

    if (uvs !== undefined) {
      faceVertexUvs[0].push([
        tempUVs[a].clone(),
        tempUVs[b].clone(),
        tempUVs[c].clone()
      ]);
    }
    if (uvs2 !== undefined) {
      faceVertexUvs[1].push([
        tempUVs2[a].clone(),
        tempUVs2[b].clone(),
        tempUVs2[c].clone()
      ]);
    }
  }

  return {
    addFace,
    faces,
    colors,
    faceVertexUvs
  };
}

function bufferGeometryToFaces(geometry) {
  var faceMaker = createFaceMakerForBufferGeometry(geometry);
  var indices = geometry.index !== null ? geometry.index.array : undefined;
  var groups = geometry.groups;
  if (groups.length > 0) {
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];

      var start = group.start;
      var count = group.count;

      for (var j = start, jl = start + count; j < jl; j += 3) {
        if (indices !== undefined) {
          faceMaker.addFace(
            indices[j],
            indices[j + 1],
            indices[j + 2],
            group.materialIndex
          );
        } else {
          faceMaker.addFace(j, j + 1, j + 2, group.materialIndex);
        }
      }
    }
  } else {
    if (indices !== undefined) {
      for (var i = 0; i < indices.length; i += 3) {
        faceMaker.addFace(indices[i], indices[i + 1], indices[i + 2]);
      }
    } else {
      for (var i = 0; i < geometry.attributes.position.count; i += 3) {
        faceMaker.addFace(i, i + 1, i + 2);
      }
    }
  }

  return faceMaker;
}

function createWorkers(
  vertices,
  faces,
  faceUVs,
  workersAmount = navigator.hardwareConcurrency,
  percentage
) {
  return new Promise((resolve, reject) => {
    // const positions = geo.attributes.position.array;
    const verticesAB = new SharedArrayBuffer(vertices.length * 3 * 4);
    const facesAB = new SharedArrayBuffer(faces.length * 3 * 4);
    const faceNormalsAB = new SharedArrayBuffer(faces.length * 9 * 4);
    const faceUVsAB = new SharedArrayBuffer(faces.length * 6 * 4);
    const costStoreAB = new SharedArrayBuffer(vertices.length * 4);
    const neighbourCollapse = new SharedArrayBuffer(vertices.length * 2);
    const faceMaterialIndex = new SharedArrayBuffer(faces.length);

    const verticesView = new Float32Array(verticesAB);
    const facesView = new Float32Array(facesAB);

    // TEMP: make functional
    globalFacesView = facesView;
    globalVertexView = verticesView;

    const faceNormalsView = new Float32Array(faceNormalsAB);
    const facesUVsView = new Float32Array(faceUVsAB);
    const costStoreView = new Float32Array(costStoreAB);
    const neighbourCollapseView = new Int16Array(neighbourCollapse);
    const faceMaterialIndexView = new Int8Array(faceMaterialIndex);

    for (let i = 0; i < vertices.length; i++) {
      verticesView[i * 3] = vertices[i].position.x;
      verticesView[i * 3 + 1] = vertices[i].position.y;
      verticesView[i * 3 + 2] = vertices[i].position.z;
    }

    const doFaceUvs = !!faceUVs.length;
    for (let i = 0; i < faces.length; i++) {
      facesView[i * 3] = faces[i].a;
      facesView[i * 3 + 1] = faces[i].b;
      facesView[i * 3 + 2] = faces[i].c;

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

    const workers = [];
    for (let i = 0; i < workersAmount; i++) {
      workers.push(new WebWorker(CostWorker));
    }

    workers.forEach((w, i) => {
      // send SharedArrayBuffers handles
      // w.postMessage({
      //   task: "load",
      //   workerIndex: i,
      //   totalWorkers: workers.length,
      //   verticesAB: verticesView.buffer,
      //   facesAB: facesView.buffer,
      //   faceNormals: faceNormalsView.buffer,
      //   faceUVsAB: facesUVsView.buffer,
      //   costStoreAB: costStoreView.buffer,
      //   faceMaterialIndexAB: faceMaterialIndexView.buffer,
      //   neighbourCollapse,
      //   percentage
      // });
      // w.addEventListener("message", doneLoading);
    });

    let doneCount = 0;
    function doneLoading(event) {
      doneCount++;
      if (event.data.task === "edgesCostsDone" && doneCount >= workersAmount) {
        workers.forEach(w => w.terminate());

        resolve({
          verticesView,
          facesView,
          faceNormalsView,
          facesUVsView,
          faceMaterialIndexView,
          costStore: costStoreView,
          neighbourCollapse: neighbourCollapseView
        });
      }
    }
  });
}

export function simplifyMesh(geometryRaw, percentage, preserveTexture = true) {
  return new Promise((resolve, reject) => {
    console.time("Mesh simplification");

    let isBufferGeometry = false;
    let geometry = geometryRaw;

    if (
      geometry instanceof BufferGeometry &&
      !geometry.vertices &&
      !geometry.faces
    ) {
      // return simplifyBufferGeometry(geometryRaw, percentage, preserveTexture);
      if (geometry.attributes.position.count < lowerLimit * 3) {
        return geometry;
      }

      console.log("converting BufferGeometry to Geometry");
      geometry = new Geometry().fromBufferGeometry(geometry);
      isBufferGeometry = true;
    }

    globalGeometry = geometry;
    if (!globalGeometry.boundingSphere) {
      globalGeometry.computeBoundingSphere();
    }

    if (geometry.vertices.length < lowerLimit * 3) {
      return geometryRaw;
    }

    geometry.mergeVertices();
    // geometry.computeVertexNormals();
    // geometry.computeFaceNormals();

    var oldVertices = geometry.vertices; // Three Position
    var oldFaces = geometry.faces; // Three Face
    var oldFaceUVs = geometry.faceVertexUvs[0];

    //
    // put data of original geometry in different data structures
    //
    var vertices = new Array(oldVertices.length); // Simplify Custom Vertex Struct
    var faces = new Array(oldFaces.length); // Simplify Custom Traignle Struct
    var faceUVs = []; // rebuild UVs
    prepareSimpleDataStructures(
      vertices,
      faces,
      faceUVs,
      oldVertices,
      oldFaces,
      oldFaceUVs,
      preserveTexture
    );

    // simulate worker
    const totalWorkers = 1;
    const workerIndex = 0;
    const range = Math.floor(vertices.length / totalWorkers);
    const start = range * workerIndex;
    const end = start + range;

    computeLeastCosts(vertices, start, end);
    // create shared array buffers for positions, normals and uvs
    createWorkers(vertices, faces, faceUVs, 4, percentage).then(
      ({
        verticesView,
        facesView,
        faceNormalsView,
        facesUVsView,
        faceMaterialIndexView,
        costStore,
        neighbourCollapse
      }) => {
        collapseLeastCostEdges(
          vertices,
          faces,
          percentage,
          costStore,
          neighbourCollapse,
          preserveTexture,
          start,
          end
        );

        setTimeout(() => {
          console.timeEnd("Mesh simplification");

          // console.log("before:", geometry.faces.length);
          // console.log("after:", newGeo.faces.length);
          // console.log(
          //   "savings:",
          //   100 - (100 / geometry.faces.length) * newGeo.faces.length,
          //   "%"
          // );
        }, 50);

        return resolve(
          createNewBufferGeometry(
            verticesView,
            facesView,
            faceNormalsView,
            facesUVsView,
            faceMaterialIndexView,
            vertices,
            faces,
            geometryRaw
          )
        );

        const newGeo = createNewGeometry(
          vertices,
          faces,
          preserveTexture && oldFaceUVs.length,
          geometry.name
        );

        // console.log(`face change from ${geometry.faces.length} to ${newGeo.faces.length}`);
        resolve(
          isBufferGeometry ? new BufferGeometry().fromGeometry(newGeo) : newGeo
        );
      }
    );
  });
}

function createNewBufferGeometry(
  vertices,
  faces,
  normalsView,
  uvsView,
  faceMaterialIndexView,
  preserveTexture,
  name,
  oldGeometry
) {
  const geo = new BufferGeometry();
  let count = 0;
  for (var i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;
    count++;
  }

  // count is total faces cout
  // each face contains 3 vertices of 3 xyz fields

  var positions = new Float32Array(count * 9); // faces * 3 vertices * vector3
  var normals = new Float32Array(count * 9);
  var uvs = new Float32Array(count * 6);

  count = 0;

  let vertexIndex = 0;
  let normalIndex = 0;
  let uvIndex = 0;
  let materialIndex = null;
  let materialCount = 0;

  for (i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;
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

    // material Index
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
    previousGroup.count = materialCount * 3;
  }

  // for (let i = 0; i < faces.length; i++) {
  //   facesView[i * 3] = faces[i].a;
  //   facesView[i * 3 + 1] = faces[i].b;
  //   facesView[i * 3 + 2] = faces[i].c;

  //   faceNormalsView[i * 3] = faces[i].normal.x;
  //   faceNormalsView[i * 3 + 1] = faces[i].normal.y;
  //   faceNormalsView[i * 3 + 2] = faces[i].normal.z;
  // }

  // for (let i = 0; i < faceUVs.length; i++) {
  //   facesUVsView[i * 6] = faceUVs[i][0].x;
  //   facesUVsView[i * 6 + 1] = faceUVs[i][0].y;
  //   facesUVsView[i * 6 + 2] = faceUVs[i][1].x;
  //   facesUVsView[i * 6 + 3] = faceUVs[i][1].y;
  //   facesUVsView[i * 6 + 4] = faceUVs[i][2].x;
  //   facesUVsView[i * 6 + 5] = faceUVs[i][2].y;
  // }

  geo.addAttribute("position", new BufferAttribute(positions, 3));

  if (normals.length > 0) {
    geo.addAttribute("normal", new BufferAttribute(normals, 3));
  }

  if (uvs.length > 0) {
    geo.addAttribute("uv", new BufferAttribute(uvs, 2));
  }

  // TEMP: just to check if manually reassembled geometry still holds together
  // geo.groups = oldGeometry.groups;

  // geo.groups.push({
  //   start: 0,
  //   count: faces.length,
  //   materialIndex: 1
  // });
  return geo;
}

function createNewGeometry(vertices, faces, preserveTexture, name) {
  var newGeo = new Geometry();
  if (preserveTexture) newGeo.faceVertexUvs[0] = [];

  for (let i = 0; i < vertices.length; i++) {
    var v = vertices[i];
    newGeo.vertices.push(v.position);
  }
  for (let i = 0; i < faces.length; i++) {
    var tri = faces[i];

    newGeo.faces.push(
      new Face3(
        vertices.indexOf(tri.v1),
        vertices.indexOf(tri.v2),
        vertices.indexOf(tri.v3),
        tri.vertexNormals,
        undefined,
        tri.materialIndex
      )
    );

    if (preserveTexture) {
      newGeo.faceVertexUvs[0].push(faces[i].faceVertexUvs);
      if (faces[i].faceVertexUvs === undefined) {
        debugger;
      }
    }
  }

  // newGeo.mergeVertices();
  //newGeo.computeFaceNormals();
  // newGeo.computeVertexNormals();
  //
  newGeo.name = name;

  return newGeo;
}

function collapseLeastCostEdges(
  vertices,
  faces,
  percentage,
  costStore,
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
  var nextVertex;
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

  while (z--) {
    nextVertex = minimumCostEdge(vertices, skip, from, to);
    // nextVertex = getNext();

    if (!nextVertex) {
      console.log("no next vertex");
      break;
    }

    if (nextVertex.id < from || nextVertex.id >= to) {
      skip++;
      continue;
    }

    var collapsed = collapse(
      vertices,
      faces,
      nextVertex,
      nextVertex.collapseNeighbor, //  vertices[neighbourCollapse[nextVertex.id]],
      preserveTexture,
      costStore
    );

    if (!collapsed) {
      skip++;
    }
  }
}

function minimumCostEdge(vertices, skip, from, to) {
  // O(n * n) approach. TODO optimize this
  var least = vertices[from + skip];

  if (least === null) {
    skip++;
    return minimumCostEdge(vertices, skip, from, to);
  }
  var v;

  if (from + skip >= to) {
    return false;
  }

  for (var i = from; i < to; i++) {
    if (i < from || i >= to - 1) {
      continue;
    }
    v = vertices[i];
    if (!v) continue;
    if (vertices[i].collapseCost < least.collapseCost) {
      least = vertices[i];
    }
  }

  return least;
}

export default simplifyMesh;
