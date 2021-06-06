export default () => {
  let FIELDS_NO = 0; // do not change this will be set with a message from main thread
  let FIELDS_OVERSIZE = 0;
  let OVERSIZE_CONTAINER_CAPACITY = 0;
  let reportWorkerId = 0;
  let reportTotalWorkers = 0;
  let reattemptIntervalMs = 500;
  let reattemptIntervalCount = 20;
  let currentReqId = -1;
  let previousDataArrayViews = null;

  self.onmessage = function(e) {
    var functionName = e.data.task;
    if (functionName && self[functionName]) {
      self[functionName](
        e.data
        // buildCallback(functionName, e.data.reqId, e.data.time)
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

  self["load"] = load;
  function load(data) {
    freeDataArrayRefs();

    const dataArrayViews = {
      costStore: data.costStore,
      verticesView: data.verticesView,
      facesView: data.facesView,
      facesUVsView: data.facesUVsView,
      faceNormalsView: data.faceNormalsView,
      faceNormalView: data.faceNormalView,
      neighbourCollapse: data.neighbourCollapse,
      faceMaterialIndexView: data.faceMaterialIndexView,
      vertexFacesView: data.vertexFacesView,
      vertexNeighboursView: data.vertexNeighboursView,
      vertexWorkStatus: data.vertexWorkStatus,
      buildIndexStatus: data.buildIndexStatus,
      costCountView: data.costCountView,
      costTotalView: data.costTotalView,
      costMinView: data.costMinView,
      id: data.id,
      specialCases: data.specialCases,
      specialCasesIndex: data.specialCasesIndex,
      specialFaceCases: data.specialFaceCases,
      specialFaceCasesIndex: data.specialFaceCasesIndex
    };
    dataArrayViews.collapseQueue = new Uint32Array(150);

    previousDataArrayViews = dataArrayViews;

    const workerIndex = data.workerIndex;
    const totalWorkers = data.totalWorkers;
    FIELDS_NO = data.FIELDS_NO;
    FIELDS_OVERSIZE = data.FIELDS_OVERSIZE;
    OVERSIZE_CONTAINER_CAPACITY = data.OVERSIZE_CONTAINER_CAPACITY;

    reportWorkerId = workerIndex;
    reportTotalWorkers = totalWorkers;
    currentReqId = data.reqId;

    const range = Math.floor(
      dataArrayViews.verticesView.length / 3 / totalWorkers
    );
    let start = range * workerIndex;
    const end = start + range;

    const buildRange = Math.floor(
      dataArrayViews.facesView.length / totalWorkers
    );
    let buildStart = buildRange * workerIndex;
    let buildEnd = buildStart + buildRange;

    buildVertexNeighboursIndex(
      dataArrayViews.facesView,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialCases,
      dataArrayViews.specialCasesIndex,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex,
      buildStart,
      buildEnd
    );

    dataArrayViews.buildIndexStatus[workerIndex] = 1;

    computeLeastCostWhenReady(
      dataArrayViews,
      data,
      start,
      end,
      workerIndex,
      totalWorkers,
      data.reqId
    );
  }

  function exitWithError(reqId, err) {
    freeDataArrayRefs();

    console.error(err);
    self.postMessage({
      task: "simplificationError",
      reqId,
      message: err
    });
  }

  function freeDataArrayRefs() {
    if (previousDataArrayViews) {
      for (var key in previousDataArrayViews) {
        delete previousDataArrayViews[key];
      }
      previousDataArrayViews = null;
    }
  }

  function computeLeastCostWhenReady(
    dataArrayViews,
    data,
    start,
    end,
    workerIndex,
    totalWorkers,
    reqId,
    attempt = 0
  ) {
    if (reqId !== currentReqId) {
      throw new Error("Mixing shit!");
    }
    for (var i = 0; i < totalWorkers; i++) {
      if (dataArrayViews.buildIndexStatus[i] < 1) {
        const nextAttempt = attempt + 1;
        if (nextAttempt > reattemptIntervalCount) {
          const err =
            "Waited for other processes to build indexes for over " +
            reattemptIntervalMs * reattemptIntervalCount +
            "ms iterations. Aborting";
          exitWithError(reqId, err);
          return;
        }
        setTimeout(() => {
          computeLeastCostWhenReady(
            dataArrayViews,
            data,
            start,
            end,
            workerIndex,
            totalWorkers,
            reqId,
            nextAttempt
          );
        }, reattemptIntervalMs);
        return;
      }
    }

    try {
      computeLeastCosts(dataArrayViews, start, end);
    } catch (e) {
      exitWithError(reqId, e.message);
      return;
    }

    dataArrayViews.buildIndexStatus[workerIndex] = 2;
    collapseWhenReady(
      dataArrayViews,
      data,
      start,
      end,
      workerIndex,
      totalWorkers,
      reqId
    );
  }

  function collapseWhenReady(
    dataArrayViews,
    data,
    start,
    end,
    workerIndex,
    totalWorkers,
    reqId,
    attempt = 0
  ) {
    if (reqId !== currentReqId) {
      throw new Error("Mixing shit!");
    }
    for (var i = 0; i < totalWorkers; i++) {
      if (dataArrayViews.buildIndexStatus[i] < 2) {
        const nextAttempt = attempt + 1;
        if (nextAttempt > reattemptIntervalCount) {
          const err =
            "Waited for other processes to compute costs for over " +
            reattemptIntervalMs * reattemptIntervalCount +
            "ms iterations. Aborting";
          exitWithError(reqId, err);
          return;
        }
        setTimeout(
          () =>
            collapseWhenReady(
              dataArrayViews,
              data,
              start,
              end,
              workerIndex,
              totalWorkers,
              reqId,
              nextAttempt
            ),
          reattemptIntervalMs
        );
        return;
      }
    }
    // // need special cases before can collapse
    try {
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
    } catch (e) {
      return exitWithError(reqId, e.message);
    }

    freeDataArrayRefs();
    self.postMessage({ task: "edgesCostsDone", reqId });
  }

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

  function bufferArrayPushIfUnique(array, object) {
    for (var i = 1, il = array[0]; i <= il; i++) {
      if (array[i] === object) {
        return;
      }
    }
    array[il + 1] = object;
    array[0]++;
    // if (array.indexOf(object) === -1) array.push(object);
  }

  function bufferArrayPush(array, el1, el2) {
    const length = array[0];
    array[length + 1] = el1;
    array[length + 2] = el2;

    array[0] += 2;
    // if (array.indexOf(object) === -1) array.push(object);
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

  function replaceVertex(
    faceId,
    oldvId,
    newvId,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialCasesIndex,
    specialFaceCases,
    specialFaceCasesIndex,
    dataArrayViews
  ) {
    if (faceId === -1 || oldvId === -1 || newvId === -1) {
      throw new Error("something is -1!!!!");
    }
    if (
      facesView[
        faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView)
      ] !== oldvId
    ) {
      throw new Error(
        "Replacing vertex in wrong place! ",
        oldvId,
        facesView[
          faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView)
        ],
        newvId
      );
    }

    const replacedPosition =
      faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView);

    dataArrayViews.costStore[oldvId] = 99999;

    // TODO: is this still needed
    removeFaceFromVertex(
      oldvId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );

    setVertexFaceAtIndex(
      newvId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );

    const v1 = facesView[faceId * 3];
    const v2 = facesView[faceId * 3 + 1];
    const v3 = facesView[faceId * 3 + 2];

    let remaining1, remaining2;
    if (oldvId === v1) {
      remaining1 = v2;
      remaining2 = v3;
    } else if (oldvId === v2) {
      remaining1 = v1;
      remaining2 = v3;
    } else if (oldvId === v3) {
      remaining1 = v2;
      remaining2 = v3;
    } else {
      throw new Error("WTF");
    }
    facesView[replacedPosition] = newvId;

    removeVertexIfNonNeighbor(oldvId, remaining1, dataArrayViews);
    removeVertexIfNonNeighbor(remaining1, oldvId, dataArrayViews);

    removeVertexIfNonNeighbor(oldvId, remaining2, dataArrayViews);
    removeVertexIfNonNeighbor(remaining2, oldvId, dataArrayViews);

    removeVertexIfNonNeighbor(oldvId, newvId, dataArrayViews);
    removeVertexIfNonNeighbor(newvId, oldvId, dataArrayViews);

    // should they be set as neighbours afer removing?
    setVertexNeighboursAtIndex(
      remaining1,
      newvId,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      newvId,
      remaining1,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );

    setVertexNeighboursAtIndex(
      remaining2,
      newvId,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      newvId,
      remaining2,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    // setVertexNeighboursAtIndex(
    //   newvId,
    //   newvId,
    //   vertexNeighboursView,
    //   specialCases,
    //   specialCasesIndex
    // );

    computeFaceNormal(faceId, facesView, dataArrayViews.verticesView);
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
  var v2Tmp = new Vector2();
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

  function removeVertexFromNeighbour(
    atIndex,
    neighbourIndex,
    target,
    specialCases,
    specialCasesIndex
  ) {
    removeFieldFromSBWithOversize(
      atIndex,
      neighbourIndex,
      target,
      specialCases,
      specialCasesIndex
    );
    removeFieldFromSBWithOversize(
      neighbourIndex,
      atIndex,
      target,
      specialCases,
      specialCasesIndex
    );
  }

  function removeFromNeighboursIndex(
    atIndex,
    target,
    specialCases,
    specialCasesIndex
  ) {
    const index = atIndex * FIELDS_NO;
    let count = target[index];

    for (var i = 0; i < count; i++) {
      const neighbourId = getFromBigData(
        atIndex,
        i,
        target,
        specialCases,
        specialCasesIndex
      );
      removeFieldFromSBWithOversize(
        neighbourId,
        atIndex,
        target,
        specialCases,
        specialCasesIndex
      );
    }

    // for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
    //   const neighbourId = target[index + i + 1];
    //   target[index + i + 1] = 0;
    //   removeFieldFromSBWithOversize(
    //     neighbourId,
    //     atIndex,
    //     target,
    //     specialCases,
    //     specialCasesIndex
    //   );
    // }

    // if (count > FIELDS_NO - 1) {
    //   specialCases[index].forEach(neighbourId =>
    //     removeFieldFromSBWithOversize(
    //       neighbourId,
    //       atIndex,
    //       target,
    //       specialCases,
    //       specialCasesIndex
    //     )
    //   );
    // }

    // target[index] = 0;
    // specialCases[index] = [];
    return;
  }
  function removeFaceFromVertex(
    vertexId,
    faceId,
    vertexFacesView,
    specialFaceCases,
    specialFaceCasesIndex
  ) {
    return removeFieldFromSBWithOversize(
      vertexId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );
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
      const offset = index * FIELDS_OVERSIZE - (FIELDS_NO - 1);
      if (offset + childIndex < index * FIELDS_OVERSIZE) {
        throw new Error("this should never happen");
      }
      return oversizeStorage[offset + childIndex];
    }
  }

  function removeVertexIfNonNeighbor(vertexId, neighbourId, dataArrayViews) {
    const {
      facesView,
      vertexFacesView,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    } = dataArrayViews;
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
      specialCases,
      specialCasesIndex
    );
  }

  function setVertexNeighboursAtIndex(
    atIndex,
    neighbourIndex,
    target,
    specialCases,
    specialCasesIndex,
    vertices
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

  function computeLeastCosts(dataArrayViews, fromIndex, toIndex) {
    // compute all edge collapse costs
    for (let i = fromIndex; i < toIndex; i++) {
      computeEdgeCostAtVertex(i, dataArrayViews);
    }

    // buildFullIndex(
    //   dataArrayViews.costStore,
    //   dataArrayViews.collapseQueue,
    //   fromIndex,
    //   toIndex
    // );

    // // create collapseQueue
    // // let costsOrdered = new Float32Array(toIndex - fromIndex);
    // let costsOrderedIndexes = new Float32Array(toIndex - fromIndex);

    // for (var i = fromIndex; i < toIndex; i++) {
    //   // costsOrdered[i - fromIndex] = dataArrayViews.costStore[i];
    //   costsOrderedIndexes[i - fromIndex] = i;
    // }

    // // sort indexes
    // costsOrderedIndexes.sort((a, b) =>
    //   dataArrayViews.costStore[a] < dataArrayViews.costStore[b]
    //     ? -1
    //     : (dataArrayViews.costStore[b] < dataArrayViews.costStore[a]) | 0
    // );

    // for (i = 0; i < 100; i++) {
    //   if (i === 0) {
    //     dataArrayViews.collapseQueue[0] = 1;
    //     continue;
    //   }
    //   dataArrayViews.collapseQueue[i] = costsOrderedIndexes[i - 1];
    // }
  }

  // function insertToCollapseQueue(vId, dataArrayViews) {
  //   const collapseArr = dataArrayViews.collapseQueue;
  //   let foundEmptyIndex = 0;
  //   for (var i = 1, il = dataArrayViews.collapseQueue.length; i < il; i++) {
  //     if (dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] === 99999) {
  //       foundEmptyIndex = i;
  //     }
  //     if (
  //       dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] !== 99999 &&
  //       dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] >
  //         dataArrayViews.costStore[vId]
  //     ) {
  //       debugger;
  //       dataArrayViews.collapseQueue[i] = vId;

  //       if (dataArrayViews.collapseQueue[0] >= i) {
  //         dataArrayViews.collapseQueue[0]++;
  //       }
  //       if (!foundEmptyIndex) {
  //         shiftArray(collapseArr, i, collapseArr.length, true);
  //       } else {
  //         shiftArray(collapseArr, foundEmptyIndex, i, false);
  //       }
  //       return;
  //     }
  //   }
  // }

  // function shiftArray(arr, shiftPoint, shiftPointEnd, directionForward) {
  //   for (var i = shiftPoint; i < shiftPointEnd; i++) {
  //     if (directionForward) {
  //       arr[i + 1] = arr[i];
  //     } else {
  //       arr[i] = arr[i + 1];
  //     }
  //   }
  // }

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
      // dataArrayViews.costStore[vId] = 0;
      removeVertex(vId, dataArrayViews);

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

    // if (
    //   !dataArrayViews.collapseQueue.includes(vId) &&
    //   dataArrayViews.collapseQueue[0] !== 0 &&
    //   cost <
    //     dataArrayViews.costStore[
    //       dataArrayViews.collapseQueue[dataArrayViews.collapseQueue.length - 1]
    //     ]
    // ) {
    //   insertToCollapseQueue(
    //     vId,
    //     dataArrayViews.costStore,
    //     dataArrayViews.collapseQueue
    //   );
    // }
  }

  function faceIdHasVertexId(faceId, vertexId, facesView) {
    if (facesView[faceId * 3] === vertexId) return true;
    if (facesView[faceId * 3 + 1] === vertexId) return true;
    if (facesView[faceId * 3 + 2] === vertexId) return true;

    return false;
  }

  const posA = new Vector3();
  const posB = new Vector3();
  function tryComputeEdgeCollapseCost(uId, vId, dataArrayViews, attempt = 0) {
    if (
      dataArrayViews.vertexWorkStatus[uId] > 0 ||
      dataArrayViews.vertexWorkStatus[vId] > 0
    ) {
      // console.log('Busy now and cant recalculate');
      // return tryComputeEdgeCollapseCost(uId, vId, dataArrayViews);
    }
    try {
      return computeEdgeCollapseCost(uId, vId, dataArrayViews);
    } catch (e) {
      if (attempt < 10) {
        throw e;
        // if this place keeps mincing doesn't it block entire neighbourhood?
        console.log(
          "Vertex neighbourhood data overwritten by another thread. Retrying",
          e
        );
        return 666;
        // const nextAttempt = attempt + 1;
        // return tryComputeEdgeCollapseCost(
        //   uId,
        //   vId,
        //   dataArrayViews,
        //   nextAttempt
        // );
      }
      console.log("PICK UP FROM HERE , WTF IS HAPPENING");
      throw e;
    }
  }
  var sideFaces = new Int32Array(2);
  var faceNormal = new Vector3();
  var sideFaceNormal = new Vector3();
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

    sideFaces[0] = -1;
    sideFaces[1] = -1;

    var vertexFaceCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];

    var i,
      il = vertexFaceCount;

    // find the 'sides' triangles that are on the edge uv
    for (i = 0; i < il; i++) {
      var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

      if (faceIdHasVertexId(faceId, vId, dataArrayViews.facesView)) {
        if (sideFaces[0] === -1) {
          sideFaces[0] = faceId;
        } else {
          sideFaces[1] = faceId;
        }
      }
    }

    // use the triangle facing most away from the sides
    // to determine our curvature term
    for (i = 0; i < il; i++) {
      var minCurvature = 1;
      var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

      for (var j = 0; j < sideFaces.length; j++) {
        var sideFaceId = sideFaces[j];
        if (sideFaceId === -1) continue;
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
    if (sideFaces[0] === -1 || sideFaces[1] === -1) {
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

  // function getFromBigData(parentId, childId, storage, oversizeStorage) {
  //   const index = parentId * FIELDS_NO + childId + 1;
  //   if (childId + 1 <= FIELDS_NO - 1) {
  //     return storage[index];
  //   } else {
  //     const store = oversizeStorage[parentId * FIELDS_NO];
  //     return store && store[childId - (FIELDS_NO - 1)];
  //   }
  // }

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

  var UVsAroundVertex = new Float32Array(500);
  var facesCount = 0;

  function getUVCost(array) {
    let cost = 0;
    for (var i = 1; i < array[0]; i += 2) {
      if (i > 0 && (v2Tmp.x !== array[i] || v2Tmp.y !== array[i + 1])) {
        cost += 1;
      }
      v2Tmp.x = array[i];
      v2Tmp.y = array[i + 1];
    }
    return cost;
  }
  // check if there are multiple texture coordinates at U and V vertices(finding texture borders)
  function computeUVsCost(uId, vId, dataArrayViews) {
    // if (!u.faces[0].faceVertexUvs || !u.faces[0].faceVertexUvs) return 0;
    // if (!v.faces[0].faceVertexUvs || !v.faces[0].faceVertexUvs) return 0;
    UVsAroundVertex[0] = 0;

    facesCount = dataArrayViews.vertexFacesView[vId * FIELDS_NO];

    for (var i = facesCount - 1; i >= 0; i--) {
      var fid = getFaceIdByVertexAndIndex(vId, i, dataArrayViews);
      if (faceIdHasVertexId(fid, uId, dataArrayViews.facesView)) {
        // UVsAroundVertex.push(getUVsOnVertexId(fid, vId, dataArrayViews));
        getUVsOnVertexId(fid, vId, dataArrayViews, v2Tmp);
        bufferArrayPush(UVsAroundVertex, v2Tmp.x, v2Tmp.y);
      }
    }

    let UVcost = getUVCost(UVsAroundVertex);

    UVsAroundVertex[0] = 0;

    const facesCount2 = dataArrayViews.vertexFacesView[uId * FIELDS_NO];
    // check if all coordinates around U have the same value
    for (i = facesCount2 - 1; i >= 0; i--) {
      let fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

      if (fid2 === undefined) {
        debugger;
        fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      }
      if (faceIdHasVertexId(fid2, vId, dataArrayViews.facesView)) {
        getUVsOnVertexId(fid2, uId, dataArrayViews, v2Tmp);
        bufferArrayPush(UVsAroundVertex, v2Tmp.x, v2Tmp.y);
      }
    }
    UVcost += getUVCost(UVsAroundVertex);
    return UVcost;
  }

  function removeVertex(vId, dataArrayViews) {
    removeFromNeighboursIndex(
      vId,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialCasesIndex
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
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );
    removeFaceFromVertex(
      v2,
      fid,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );
    removeFaceFromVertex(
      v3,
      fid,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );

    removeVertexIfNonNeighbor(v1, v2, dataArrayViews);
    removeVertexIfNonNeighbor(v2, v1, dataArrayViews);
    removeVertexIfNonNeighbor(v1, v3, dataArrayViews);
    removeVertexIfNonNeighbor(v3, v1, dataArrayViews);
    removeVertexIfNonNeighbor(v2, v3, dataArrayViews);
    removeVertexIfNonNeighbor(v3, v2, dataArrayViews);

    // shrinkMaterialSpace(fid, dataArrayViews);
  }

  var moveToThisNormalValues = [new Vector3(), new Vector3(), new Vector3()];
  var tmpVertices = new Uint32Array(500);
  var neighhbourId = 0;
  function collapse(uId, vId, preserveTexture, dataArrayViews) {
    // indicating that work is in progress on this vertex and neighbour (with which it creates about to be collapsed edge)
    // the neighbour might be in another worker's range or uId might be a neighbour of a vertex in another worker's range
    dataArrayViews.vertexWorkStatus[uId] = 1;
    if (vId !== null) {
      dataArrayViews.vertexWorkStatus[vId] = 1;
    }
    if (vId === null) {
      // u is a vertex all by itself so just delete it..
      removeVertex(uId, dataArrayViews);
      dataArrayViews.vertexWorkStatus[uId] = 0;
      return true;
    }

    const neighboursView = dataArrayViews.vertexNeighboursView;
    const neighboursCountV = neighboursView[vId * FIELDS_NO];
    const neighboursCountU = neighboursView[uId * FIELDS_NO];

    var i;
    tmpVertices[0] = 0;

    for (i = 0; i < neighboursCountU; i++) {
      neighhbourId = getVertexNeighbourByIndex(uId, i, dataArrayViews);
      dataArrayViews.vertexWorkStatus[neighhbourId] = 2;
      bufferArrayPushIfUnique(tmpVertices, neighhbourId);
    }

    // TODO: This might be unneccessary. Is there a need to actually recalculating ALL neighbours of not-removed vertex?
    // for (i = 0; i < neighboursCountV; i++) {
    //   neighhbourId = getVertexNeighbourByIndex(vId, i, dataArrayViews);
    //   dataArrayViews.vertexWorkStatus[neighhbourId] = 2;
    //   bufferArrayPushIfUnique(tmpVertices, neighhbourId);
    // }

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

    // // TODO: did it reach face 0?
    // // update remaining triangles to have v instead of u
    for (i = facesCount - 1; i >= 0; i--) {
      replaceVertex(
        getFaceIdByVertexAndIndex(uId, i, dataArrayViews),
        uId,
        vId,
        dataArrayViews.facesView,
        dataArrayViews.vertexFacesView,
        dataArrayViews.vertexNeighboursView,
        dataArrayViews.specialCases,
        dataArrayViews.specialCasesIndex,
        dataArrayViews.specialFaceCases,
        dataArrayViews.specialFaceCasesIndex,
        dataArrayViews
      );
    }
    removeVertex(uId, dataArrayViews);
    // recompute the edge collapse costs in neighborhood
    for (var i = 1, il = tmpVertices[0]; i <= il; i++) {
      // uncomment when ready
      computeEdgeCostAtVertex(tmpVertices[i], dataArrayViews);
      if (dataArrayViews.vertexWorkStatus[tmpVertices[i]] === 2) {
        dataArrayViews.vertexWorkStatus[tmpVertices[i]] = 0;
      }
    }
    dataArrayViews.vertexWorkStatus[uId] = 0; // or maybe 2 to indicate that the work is done
    if (vId !== null) {
      dataArrayViews.vertexWorkStatus[vId] = 0; // vId remains so definitely 0
    }
    return true;
  }

  function getPointInBetweenByPerc(pointA, pointB, percentage) {
    var dir = v1Temp.copy(pointB).sub(pointA);
    var len = dir.length();
    dir = dir.normalize().multiplyScalar(len * percentage);
    return dir.add(pointA);
  }

  function getUVsOnVertexId(faceId, vertexId, dataArrayViews, target) {
    target.x =
      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) * 2
      ];
    target.y =
      dataArrayViews.facesUVsView[
        faceId * 6 +
          getVertexIndexOnFaceId(faceId, vertexId, dataArrayViews.facesView) *
            2 +
          1
      ];
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

    throw new Error(
      "Vertex not found " +
        vertexId +
        " faceid: " +
        faceId +
        " worker index " +
        reportWorkerId +
        " / " +
        reportTotalWorkers
    );
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

    let collapsedCount = 0;

    while (z--) {
      // after skipping 20 start again
      if (skip > 30) {
        skip = 0;
      }
      nextVertexId = minimumCostEdge(vertices, skip, from, to, dataArrayViews);
      // nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
      // if (nextVertexId === false) {
      //   buildFullIndex(
      //     dataArrayViews.costStore,
      //     dataArrayViews.collapseQueue,
      //     from,
      //     to
      //   );
      //   nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
      // }
      if (nextVertexId === false) {
        console.log("Skipped all the way or cost only > 500");
        break;
      }

      if (dataArrayViews.vertexWorkStatus[nextVertexId] > 0) {
        // z++;
        z++;
        skip++;
        // console.log("work on this one going. skipping");
        continue;
      }

      // if (nextVertexId < from || nextVertexId >= to) {
      //   console.log('skipping: ', nextVertexId);
      //   skip++;
      //   continue;
      // }
      const neighbourId = dataArrayViews.neighbourCollapse[nextVertexId];
      if (dataArrayViews.vertexWorkStatus[neighbourId] > 0) {
        z++;
        skip++;
        // console.log("work on collapse neighbour going. skipping");
        continue;
      }
      try {
        collapse(nextVertexId, neighbourId, preserveTexture, dataArrayViews);
      } catch (e) {
        console.log("not collapsed" + e.message);
      }
      skip = 0;
      collapsedCount++;

      // TEMO: this kind of fixes but breaks everything
      // looks what's happening in CONSOLE.ASSERT
      // dataArrayViews.costStore[nextVertexId] = 9999;
    }
    console.log(
      "Worker ",
      // workerIndex,
      " removed ",
      collapsedCount,
      " / ",
      dataArrayViews.verticesView.length / 3
    );
  }

  function minimumCostEdge(vertices, skip, from, to, dataArrayViews) {
    // // O(n * n) approach. TODO optimize this
    var leastV = false;

    if (from + skip >= to - 1) {
      return false;
    }

    for (var i = from + skip; i < to; i++) {
      if (leastV === false) {
        if (dataArrayViews.costStore[i] < 500) {
          leastV = i;
        }
      } else if (
        dataArrayViews.costStore[i] < dataArrayViews.costStore[leastV]
      ) {
        leastV = i;
      }
    }
    return leastV;
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

  function insertToCollapseQueue(inInValues, valuesArray, orderingArray) {
    let foundEmptyIndex = 0;
    for (var i = 1, il = orderingArray.length; i < il; i++) {
      if (orderingArray[i] === EMPTY_QUEUE_VALUE) {
        foundEmptyIndex = i;
      }
      if (
        valuesArray[orderingArray[i]] !== EMPTY_QUEUE_VALUE &&
        valuesArray[orderingArray[i]] > valuesArray[inInValues]
      ) {
        if (orderingArray[0] >= i) {
          orderingArray[0]++;
        }
        if (!foundEmptyIndex) {
          shiftArray(orderingArray, inInValues, i, orderingArray.length, true);
        } else {
          shiftArray(orderingArray, inInValues, foundEmptyIndex, i, false);
        }
        return;
      }
    }
  }

  function shiftArray(
    arr,
    insertedValue,
    shiftPoint,
    shiftPointEnd,
    directionForward
  ) {
    if (directionForward) {
      let previous = insertedValue;
      let temp = 0;
      for (var i = shiftPoint; i < shiftPointEnd; i++) {
        if (arr[i] === EMPTY_QUEUE_VALUE) {
          arr[i] = previous;
          return;
        } else {
          temp = arr[i];
          arr[i] = previous;
          previous = temp;
        }
      }
      return;
    } else {
      if (shiftPoint === shiftPointEnd) {
        arr[i] = insertedValue;
      }
      for (var i = shiftPoint; i < shiftPointEnd; i++) {
        arr[i] = arr[i + 1];
      }
      arr[shiftPointEnd - 1] = insertedValue;
    }
  }

  /**@abstract returns next value
   * 0 - first element is the current value
   * taken value is replaced by EMPTY_QUEUE_VALUE (99999)
   */
  function takeNextValue(orderingArr) {
    // debugger;
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

  // FLAT ARRAY MANAGER BELOW
  // https://codesandbox.io/s/oversized-sab-manager-36rgo

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
      // console.log('Cannot remove from empty element');
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
            if (poppedEl !== false) {
              // when this was overwritten by some thread
              sbContainer[index + i + 1] = poppedEl;
            }
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
      // debugger;
      // console.log(
      //   'Cannot remove not existing element',
      //   indexId,
      //   elementToRemove
      // );
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
      if (length === -1) {
        throw new Error("it should never be -1 here");
      }
      if (length > 100) {
        console.log("high length", length);
      }

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

  function oversizedIncludes(
    container,
    containerIndex,
    parentIndex,
    childIndex
  ) {
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
      console.warn("removing non empty oversized container", length);
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

    if (length === 0) {
      // console.warn('thread safe? Cant pop empty element');
      return false;
    }

    oversizeContainer[offset + length] = -1; // clear popped element
    length--;
    oversizeContainer[offset] = length; // update length
    if (length === 0) {
      // if reducing from 1 this is last element
      removeOversizedContainer(
        oversizeContainer,
        oversizeContainerIndex,
        index
      );
    }
    return poppedElement;
  }

  // KEEP THIS LINE
};
