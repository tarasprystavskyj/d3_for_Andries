console.log("worker on");
export default () => {
  let FIELDS_NO = 0; // do not change this will be set with a message from main thread
  self.onmessage = function(e) {
    var functionName = e.data.task;
    if (functionName && self[functionName]) {
      self[functionName](
        e.data,
        buildCallback(functionName, e.data.reqId, e.data.time)
      );
    } else if (functionName !== "init") {
      console.warn(
        "functionName: ",
        functionName,
        "not supported or not exported"
      );
    }
  };

  function buildCallback(functionName, reqId, time) {
    return function(data) {
      var message = {
        functionName,
        reqId,
        time,
        result: data
      };
      self.postMessage(message);
    };
  }

  let costStore,
    verticesView,
    facesView,
    rawFaceUVs,
    faces,
    faceNormals,
    faceUVs,
    vertices,
    neighbourCollapse,
    workerIndex,
    totalWorkers;
  self["load"] = load;
  function load(data) {
    const dataArrayViews = {
      costStore: data.costStore,
      verticesView: data.verticesView,
      facesView: data.facesView,
      facesUVsView: data.facesUVsView,
      faceNormalsView: data.faceNormalsView,
      faceNormalView: data.faceNormalView,
      neighbourCollapse: data.neighbourCollapseView,
      faceMaterialIndexView: data.faceMaterialIndexView,
      vertexFacesView: data.vertexFacesView,
      vertexNeighboursView: data.vertexNeighboursView,
      costCountView: data.costCountView,
      costTotalView: data.costTotalView,
      costMinView: data.costMinView
    };

    workerIndex = data.workerIndex;
    totalWorkers = data.totalWorkers;
    FIELDS_NO = data.FIELDS_NO;

    const range = Math.floor(
      dataArrayViews.verticesView.length / 3 / totalWorkers
    );
    const start = range * workerIndex;
    const end = start + range;

    // console.log("workerIndex: ", data.workerIndex, " / ", data.totalWorkers);
    // console.log("start: ", start, " End:", end);

    // temporary evil - should be nicely SABd instead of copying
    dataArrayViews.specialCases = data.specialCases;
    dataArrayViews.specialFaceCases = data.specialFaceCases;

    // if (workerIndex !== 0 && workerIndex !== 1) {
    //   self.postMessage({ task: "edgesCostsDone" });
    //   return;
    // }

    computeLeastCosts(dataArrayViews, start, end);
    // for (let key in dataArrayViews) {
    //   console.log(key, dataArrayViews[key]);
    // }

    // // need special cases before can collapse
    collapseLeastCostEdges(
      undefined,
      undefined,
      data.percentage,
      dataArrayViews,
      undefined,
      data.preserveTexture,
      start,
      end
    );
    self.postMessage({ task: "edgesCostsDone" });
  }

  // example teask
  // self["computeEdgesCost"] = computeEdgesCost;
  // function computeEdgesCost(fromIndex, toIndex) {
  //   console.log("asd", simplyfyModifier);
  //   computeEdgesCost(geo, costStore, fromIndex, toIndex);
  // }

  //
  //
  //
  // USELESS BULLSHIT BELOW
  // CodeSandbox doesn't support imports in workers so pasted simpliffyModifier code here
  //
  //
  //
  //

  /*
   *  @author zz85 / http://twitter.com/blurspline / http://www.lab4games.net/zz85/blog
   *  @author Pawel Misiurski - UVs collapse cost and preservation https://stackoverflow.com/users/696535/pawel
   *  Simplification Geometry Modifier
   *    - based on code and technique
   *    - by Stan Melax in 1998
   *    - Progressive Mesh type Polygon Reduction Algorithm
   *    - http://www.melax.com/polychop/
   */

  function pushIfUnique(array, object) {
    if (array.indexOf(object) === -1) array.push(object);
  }

  function removeFromArray(array, object) {
    var k = array.indexOf(object);
    if (k > -1) array.splice(k, 1);
  }

  var cb = new Vector3(),
    ab = new Vector3();
  function computeNormal(v1, v2, v3, target) {
    // no need to compute normal because it can be obtained from geometry
    // in case it's needed again and it's not availale from normal it can be calculated by averaging this.vertexNormals
    var vA = this.v1.position;
    var vB = this.v2.position;
    var vC = this.v3.position;
    cb.subVectors(vC, vB);
    ab.subVectors(vA, vB);
    cb.cross(ab).normalize();
    this.normal.copy(cb);
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

    dataArrayViews.costStore[oldvId] = 99999;

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
    removeFieldFromSBWithOversize(
      atIndex,
      neighbourIndex,
      target,
      specialCases
    );
    removeFieldFromSBWithOversize(
      neighbourIndex,
      atIndex,
      target,
      specialCases
    );
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
        removeFieldFromSBWithOversize(
          neighbourId,
          atIndex,
          target,
          specialCases
        )
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

  function removeFieldFromSBWithOversize(
    indexId,
    elementToRemove,
    sbContainer,
    oversizeContainer
  ) {
    let index = indexId * FIELDS_NO;
    let count = sbContainer[index];
    let oversize = false;

    if (count === 0) {
      return;
    }
    if (count > FIELDS_NO - 1) {
      oversize = true;
    }
    let found = false;

    if (oversize) {
      const indexOf = oversizeContainer[index].indexOf(elementToRemove);
      if (indexOf !== -1) {
        oversizeContainer[index].splice(indexOf, 1);
        found = true;
      }
    }

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
            const poppedEl = oversizeContainer[index].pop();
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
    return;
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
    vertices
  ) {
    addToSBWithOversize(atIndex, neighbourIndex, target, specialCases);
  }

  function addToSBWithOversize(atIndex, childIndex, target, oversizeContainer) {
    const index = atIndex * FIELDS_NO;
    let count = target[index];
    if (count === 0) {
      count++;
      target[index] = count;
      target[index + count] = childIndex;
      return;
    }

    let oversize = false;
    if (count >= FIELDS_NO - 1) {
      oversize = true;
    }

    for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
      if (target[index + i + 1] === childIndex) {
        return;
      }
    }
    if (
      oversize &&
      !addToOversizeContainer(
        oversizeContainer,
        index,
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

  function setVertexFaceAtIndex(atIndex, faceIndex, target, specialFaceCases) {
    addToSBWithOversize(atIndex, faceIndex, target, specialFaceCases);
  }

  function addToOversizeContainer(
    container,
    parentIndex,
    childIndex,
    reset = false
  ) {
    if (!container[parentIndex] || reset) {
      container[parentIndex] = [childIndex];
      return true;
    } else if (container[parentIndex].includes(childIndex)) {
      return false;
    } else {
      container[parentIndex].push(childIndex);
      return true;
    }
  }

  function buildVertexNeighboursIndex(
    facesView,
    target,
    vertexFacesView,
    specialCases,
    specialFaceCases,
    vertices
  ) {
    let faceId = 0;
    // each face takes 3 fields a. b. c vertices ids
    for (var i = 0; i < facesView.length; i += 3) {
      setVertexNeighboursAtIndex(
        facesView[i],
        facesView[i + 1],
        target,
        specialCases,
        vertices
      );
      setVertexNeighboursAtIndex(
        facesView[i],
        facesView[i + 2],
        target,
        specialCases,
        vertices
      );

      setVertexNeighboursAtIndex(
        facesView[i + 1],
        facesView[i],
        target,
        specialCases,
        vertices
      );
      setVertexNeighboursAtIndex(
        facesView[i + 1],
        facesView[i + 2],
        target,
        specialCases,
        vertices
      );

      setVertexNeighboursAtIndex(
        facesView[i + 2],
        facesView[i],
        target,
        specialCases,
        vertices
      );
      setVertexNeighboursAtIndex(
        facesView[i + 2],
        facesView[i + 1],
        target,
        specialCases,
        vertices
      );

      setVertexFaceAtIndex(
        facesView[i],
        faceId,
        vertexFacesView,
        specialFaceCases
      );
      setVertexFaceAtIndex(
        facesView[i + 1],
        faceId,
        vertexFacesView,
        specialFaceCases
      );
      setVertexFaceAtIndex(
        facesView[i + 2],
        faceId,
        vertexFacesView,
        specialFaceCases
      );

      faceId++;
    }
  }

  function isNeighbour(vertexId, vertex2Id, dataArrayViews) {
    dataArrayViews.faceVertexUvs.indexOf();
  }

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
      vertices[i] = oldVertices[i]; //new Vertex(oldVertices[i], i);
    }

    if (preserveTexture && oldFaceUVs.length) {
      // add UVs
      for (let i = 0; i < oldFaceUVs.length; i++) {
        const faceUV = oldFaceUVs[i];
        faceUVs.push(faceUV);
        // faceUVs.push([
        //   new Vector2(faceUV[0].x, faceUV[0].y),
        //   new Vector2(faceUV[1].x, faceUV[1].y),
        //   new Vector2(faceUV[2].x, faceUV[2].y)
        // ]);
      }
    }

    // add faces
    for (let i = 0, il = oldFaces.length; i < il; i++) {
      const face = oldFaces[i];
      faces[i] = oldFaces[i];
      // faces[i] = new Triangle(
      //   vertices[face.a],
      //   vertices[face.b],
      //   vertices[face.c],
      //   face.a,
      //   face.b,
      //   face.c,
      //   faceUVs[i],
      //   face.normal,
      //   face.vertexNormals.map(el => el.clone()),
      //   face.materialIndex,
      //   i
      // );
    }
  }

  function computeLeastCosts(dataArrayViews, fromIndex, toIndex) {
    // compute all edge collapse costs
    for (let i = fromIndex; i < toIndex; i++) {
      computeEdgeCostAtVertex(i, dataArrayViews);
    }
  }

  function computeEdgeCostAtVertex(vId, dataArrayViews) {
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

    // search all neighboring edges for "least cost" edge
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
    // much different will the model change, i.e. the "error".
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
      il = vertexFaceCount;

    // find the "sides" triangles that are on the edge uv
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

  function getFromBigData(parentId, childId, storage, oversizeStorage) {
    const index = parentId * FIELDS_NO + childId + 1;
    if (childId + 1 <= FIELDS_NO - 1) {
      return storage[index];
    } else {
      const store = oversizeStorage[parentId * FIELDS_NO];
      return store && store[childId - (FIELDS_NO - 1)];
    }
  }

  function getVertexNeighbourByIndex(vId, neighbourIndex, dataArrayViews) {
    return getFromBigData(
      vId,
      neighbourIndex,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases
    );
  }

  function getFaceIdByVertexAndIndex(vId, i, dataArrayViews) {
    return getFromBigData(
      vId,
      i,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases
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
    dataArrayViews.costStore[vId] = 99999;
  }

  function shrinkMaterialSpace(faceId, dataArrayViews) {
    const groupsLength = dataArrayViews.faceMaterialIndexView.length / 3;
    for (var i = 0; i < groupsLength; i++) {
      const groupStart = dataArrayViews.faceMaterialIndexView[i * 3];
      const count = dataArrayViews.faceMaterialIndexView[i * 3 + 1];
      const groupEnd = groupStart + count;
      if (faceId >= groupStart && faceId < groupEnd) {
        dataArrayViews.faceMaterialIndexView[i * 3 + 1]--;
      }
      // all following groups will start 1 element sooner
      if (groupStart > faceId) {
        dataArrayViews.faceMaterialIndexView[i * 3]--;
      }
    }
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
    // shrinkMaterialSpace(fid, dataArrayViews);
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
                getVertexIndexOnFaceId(faceId, vId, dataArrayViews.facesView) *
                  2
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
            getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
              2
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
            getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
              3
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

  /**
   * modify - will reduce vertices and faces count
   * mergeVertices might be needed prior
   * @param count int how many vertices to remove ie. 60% removal Math.round(geo.vertices.count * 0.6)
   **/

  const lowerLimit = 51;

  function createFaceMakerForBufferGeometry(geometry) {
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
        tempNormals.push(
          new Vector3(normals[i], normals[i + 1], normals[i + 2])
        );
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
      const vertexNeighboursAB = new SharedArrayBuffer(
        vertices.length * FIELDS_NO * 4
      );
      const vertexFacesAB = new SharedArrayBuffer(
        vertices.length * FIELDS_NO * 4
      );

      const verticesView = new Float32Array(verticesAB);
      const facesView = new Int32Array(facesAB);

      const faceNormalView = new Float32Array(
        new SharedArrayBuffer(faces.length * 3 * 4)
      );
      const faceNormalsView = new Float32Array(faceNormalsAB);
      const facesUVsView = new Float32Array(faceUVsAB);
      const costStoreView = new Float32Array(costStoreAB);
      const costCountView = new Float32Array(
        new SharedArrayBuffer(vertices.length * 4)
      );
      const costTotalView = new Float32Array(
        new SharedArrayBuffer(vertices.length * 4)
      );
      const costMinView = new Float32Array(
        new SharedArrayBuffer(vertices.length * 4)
      );
      const neighbourCollapseView = new Int16Array(neighbourCollapse);
      const faceMaterialIndexView = new Int8Array(faceMaterialIndex);

      // 10 elements, up to 9 neighbours per vertex + first number tells how many neighbours
      const vertexNeighboursView = new Uint32Array(vertexNeighboursAB);
      const vertexFacesView = new Uint32Array(vertexFacesAB);

      const specialCases = [];
      const specialFaceCases = [];

      for (let i = 0; i < vertices.length; i++) {
        verticesView[i * 3] = vertices[i].x;
        verticesView[i * 3 + 1] = vertices[i].y;
        verticesView[i * 3 + 2] = vertices[i].z;
      }

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

      const workers = [];
      for (let i = 0; i < workersAmount; i++) {
        workers.push(new WebWorker(CostWorker.default));
      }

      workers.forEach((w, i) => {
        // send SharedArrayBuffers handles
        w.postMessage({
          task: "load",
          workerIndex: i,
          totalWorkers: workers.length,
          verticesAB: verticesView.buffer,
          facesAB: facesView.buffer,
          faceNormalAB: faceNormalView.buffer,
          faceNormals: faceNormalsView.buffer,
          faceUVsAB: facesUVsView.buffer,
          costStoreAB: costStoreView.buffer,
          faceMaterialIndexAB: faceMaterialIndexView.buffer,
          costCountAB: costCountView.buffer,
          costTotalAB: costTotalView.buffer,
          costMinAB: costMinView.buffer,
          neighbourCollapse,
          percentage
        });
        w.addEventListener("message", doneLoading);
      });

      buildVertexNeighboursIndex(
        facesView,
        vertexNeighboursView,
        vertexFacesView,
        specialCases,
        specialFaceCases,
        vertices
      );

      let doneCount = 0;
      function doneLoading(event) {
        doneCount++;
        if (
          event.data.task === "edgesCostsDone" &&
          doneCount >= workersAmount
        ) {
          workers.forEach(w => w.terminate());

          resolve({
            verticesView,
            facesView,
            faceNormalView,
            faceNormalsView,
            facesUVsView,
            faceMaterialIndexView,
            vertexFacesView,
            vertexNeighboursView,
            specialCases,
            specialFaceCases,
            costStore: costStoreView,
            costCountView,
            costTotalView,
            costMinView,
            neighbourCollapse: neighbourCollapseView
          });
        }
      }
    });
  }

  function simplifyMesh(geometryRaw, percentage, preserveTexture = true) {
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
      var vertices = oldVertices; //;new Array(oldVertices.length); // Simplify Custom Vertex Struct
      var faces = oldFaces; //new Array(oldFaces.length); // Simplify Custom Traignle Struct
      var faceUVs = oldFaceUVs; // rebuild UVs
      // prepareSimpleDataStructures(
      //   vertices,
      //   faces,
      //   faceUVs,
      //   oldVertices,
      //   oldFaces,
      //   oldFaceUVs,
      //   preserveTexture
      // );

      // simulate worker
      const totalWorkers = 1;
      const workerIndex = 0;
      const range = Math.floor(vertices.length / totalWorkers);
      const start = range * workerIndex;
      const end = start + range;

      // create shared array buffers for positions, normals and uvs
      createWorkers(vertices, faces, faceUVs, 4, percentage).then(
        dataArrayViews => {
          const {
            verticesView,
            facesView,
            faceNormalsView,
            facesUVsView,
            faceMaterialIndexView,
            costStore,
            neighbourCollapse
          } = dataArrayViews;
          computeLeastCosts(dataArrayViews, start, end);

          collapseLeastCostEdges(
            vertices,
            faces,
            percentage,
            dataArrayViews,
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
        }
      );
    });
  }

  function verifyNeighboursNumber(
    vertices,
    vertexNeighboursView,
    specialCases,
    specialFaceCases
  ) {
    const nbView = vertexNeighboursView;
    let neighboursNoCorrect = [];

    for (var i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (v === null) continue;
      if (v.neighbors.length !== nbView[v.id * FIELDS_NO]) {
        neighboursNoCorrect.push([
          neighboursNoCorrect,
          v.neighbors.length,
          nbView[v.id * FIELDS_NO]
        ]);
      }

      const count = vertexNeighboursView[v.id * FIELDS_NO];

      if (
        count < FIELDS_NO &&
        specialCases[v.id * FIELDS_NO] &&
        specialCases[v.id * FIELDS_NO].length
      ) {
        debugger;
      }
      const verts = [];
      for (var j = 0; j < count; j++) {
        verts.push(vertexNeighboursView[v.id * FIELDS_NO + j + 1]);
      }
      v.neighbors.forEach(el => {
        if (
          !verts.includes(el.id) &&
          (specialCases[v.id * FIELDS_NO] &&
            !specialCases[v.id * FIELDS_NO].includes(el.id))
        )
          debugger;
        if (
          verts.find(el2 => el2 === el.id) === undefined &&
          !specialCases[v.id * FIELDS_NO].includes(el.id)
        ) {
          debugger;
        }
      });
    }

    // console.log(
    //   "Naighbours correct?",
    //   neighboursNoCorrect.length > 0 ? neighboursNoCorrect : "true"
    // );
    if (neighboursNoCorrect.length) {
      debugger;
    }
  }

  function verifyFacesNumber(
    vertices,
    vertexFacesView,
    specialCases,
    specialFaceCases
  ) {
    const facView = vertexFacesView;
    let facesNoCorrect = [];
    for (var i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (v === null) continue;
      if (v.faces.length !== facView[v.id * FIELDS_NO]) {
        facesNoCorrect.push([
          facesNoCorrect,
          v.faces.length,
          facView[v.id * FIELDS_NO]
        ]);
      }

      const count = vertexFacesView[v.id * FIELDS_NO];

      if (
        count < FIELDS_NO &&
        specialFaceCases[v.id * FIELDS_NO] &&
        specialFaceCases[v.id * FIELDS_NO].length
      ) {
        debugger;
      }
      const verts = [];
      for (var j = 0; j < count; j++) {
        verts.push(vertexFacesView[v.id * FIELDS_NO + j + 1]);
      }
      v.faces.forEach(el => {
        if (
          !verts.includes(el.id) &&
          (specialFaceCases[v.id * FIELDS_NO] &&
            !specialFaceCases[v.id * FIELDS_NO].includes(el.id))
        )
          debugger;
        if (
          verts.find(el2 => el2 === el.id) === undefined &&
          (specialFaceCases[v.id * FIELDS_NO] &&
            !specialFaceCases[v.id * FIELDS_NO].includes(el.id))
        ) {
          debugger;
        }
      });
    }
    // console.log(
    //   "Faces correct?",
    //   facesNoCorrect.length > 0 ? facesNoCorrect : "true"
    // );
    if (facesNoCorrect.length) {
      debugger;
    }
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
      // if (faceMaterialIndexView[i * 3] !== materialIndex) {
      //   materialIndex = faceMaterialIndexView[i * 3];
      //   let previousGroup;

      //   if (geo.groups.length) {
      //     previousGroup = geo.groups[geo.groups.length - 1];
      //     previousGroup.count = materialCount * 3;
      //   }
      //   geo.groups.push({
      //     start: count * 3,
      //     count: 0,
      //     materialIndex: materialIndex
      //   });

      //   materialCount = 1;
      // } else {
      //   materialCount++;
      // }

      count++;
    }

    // close last material group
    if (geo.groups.length) {
      const previousGroup = geo.groups[geo.groups.length - 1];
      previousGroup.count = materialCount * 3;
    }

    geo.addAttribute("position", new BufferAttribute(positions, 3));

    if (normals.length > 0) {
      geo.addAttribute("normal", new BufferAttribute(normals, 3));
    }

    if (uvs.length > 0) {
      geo.addAttribute("uv", new BufferAttribute(uvs, 2));
    }
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

    const collapsedArr = [];

    while (z--) {
      nextVertexId = minimumCostEdge(vertices, skip, from, to, dataArrayViews);
      if (collapsedArr.includes(nextVertexId)) {
        console.log("WTF");
      }
      collapsedArr.push(nextVertexId);

      if (!nextVertexId) {
        console.log("no next vertex");
        break;
      }

      if (nextVertexId < from || nextVertexId >= to) {
        console.log("skipping: ", nextVertexId);
        skip++;
        continue;
      }

      var collapsed = collapse(
        nextVertexId,
        dataArrayViews.neighbourCollapse[nextVertexId],
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
    console.log(
      "Worker ",
      workerIndex,
      " removed ",
      collapsedArr.length,
      " / ",
      dataArrayViews.verticesView.length / 3,
      collapsedArr
    );
  }

  function minimumCostEdge(vertices, skip, from, to, dataArrayViews) {
    // O(n * n) approach. TODO optimize this
    var leastV = from + skip;
    // var leastV = from + skip;

    if (leastV === null) {
      skip++;
      return minimumCostEdge(vertices, skip, from, to, dataArrayViews);
    }

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

  //
  //
  //
  // Even more useless bullshit
  // CodeSandbox doesn't support imports in workers so pasted
  //
  //
  //
  //

  const blankVertexNormals = [new Vector3(), new Vector3(), new Vector3()];

  // copy paste from simplifyModifier
  function prepareSimpleDataStructuresInWorker(
    vertices,
    faces,
    faceUVs,
    oldVertices,
    oldFaces,
    oldFaceUVs,
    preserveTexture
  ) {
    for (let i = 0, il = oldVertices.length / 3; i < il; i++) {
      vertices[i] = new Vertex(
        new Vector3(
          oldVertices[i * 3],
          oldVertices[i * 3 + 1],
          oldVertices[i * 3 + 2]
        ),
        i
      );
    }

    if (preserveTexture && oldFaceUVs.length) {
      for (let i = 0; i < oldFaceUVs.length / 6; i++) {
        faceUVs.push([
          new Vector2(oldFaceUVs[i * 6], oldFaceUVs[i * 6 + 1]),
          new Vector2(oldFaceUVs[i * 6 + 2], oldFaceUVs[i * 6 + 3]),
          new Vector2(oldFaceUVs[i * 6 + 4], oldFaceUVs[i * 6 + 5])
        ]);
      }
    }

    // add faces
    for (let i = 0, il = oldFaces.length / 3; i < il; i++) {
      const face = oldFaces[i];
      faces[i] = new Triangle(
        vertices[oldFaces[i * 3]],
        vertices[oldFaces[i * 3 + 1]],
        vertices[oldFaces[i * 3 + 2]],
        oldFaces[i * 3],
        oldFaces[i * 3 + 1],
        oldFaces[i * 3 + 2],
        faceUVs[i],
        new Vector3(
          faceNormals[i * 3],
          faceNormals[i * 3 + 1],
          faceNormals[i * 3 + 2]
        ), // blankVertexNormals[0][0], // TODO: this will cause trouble
        blankVertexNormals,
        0,
        i
      );
    }
  }

  function Vector2(x, y) {
    this.x = x || 0;
    this.y = y || 0;
  }

  Vector2.prototype.copy = function(v) {
    this.x = v.x;
    this.y = v.y;

    return this;
  };

  function Vector3(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }

  Vector3.prototype.set = function(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  };

  Vector3.prototype.isVector3 = true;

  Vector3.prototype.subVectors = function(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;

    return this;
  };

  Vector3.prototype.cross = function(v, w) {
    if (w !== undefined) {
      console.warn(
        "THREE.Vector3: .cross() now only accepts one argument. Use .crossVectors( a, b ) instead."
      );
      return this.crossVectors(v, w);
    }

    return this.crossVectors(this, v);
  };

  Vector3.prototype.crossVectors = function(a, b) {
    var ax = a.x,
      ay = a.y,
      az = a.z;
    var bx = b.x,
      by = b.y,
      bz = b.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;

    return this;
  };

  Vector3.prototype.multiplyScalar = function(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;

    return this;
  };

  Vector3.prototype.divideScalar = function(scalar) {
    return this.multiplyScalar(1 / scalar);
  };

  Vector3.prototype.length = function() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  };

  Vector3.prototype.normalize = function() {
    return this.divideScalar(this.length() || 1);
  };

  Vector3.prototype.copy = function(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;

    return this;
  };

  Vector3.prototype.distanceToSquared = function(v) {
    var dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;
  };

  Vector3.prototype.dot = function(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  };

  Vector3.prototype.clone = function() {
    return new this.constructor(this.x, this.y, this.z);
  };

  Vector3.prototype.sub = function(v, w) {
    if (w !== undefined) {
      console.warn(
        "THREE.Vector3: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."
      );
      return this.subVectors(v, w);
    }

    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;

    return this;
  };

  Vector3.prototype.add = function(v, w) {
    if (w !== undefined) {
      console.warn(
        "THREE.Vector3: .add() now only accepts one argument. Use .addVectors( a, b ) instead."
      );
      return this.addVectors(v, w);
    }

    this.x += v.x;
    this.y += v.y;
    this.z += v.z;

    return this;
  };
};
