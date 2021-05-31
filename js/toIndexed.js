import { BufferGeometry, BufferAttribute } from "/js/three.module.js";

//
// build index and unique positions
// it's like indexed geometry but only index and positions attributes
//  we'll us  non-indexed geometry for other attributes to preserve all the details
//

export const getIndexedPositions = (function() {
  let prec = Math.pow(10, 6);
  let vertices = {};
  let id = "";
  let oldVertexIndexByNewIndex = [];

  function store(x, y, z, v, positions) {
    id =
      "_" + Math.floor(x * prec) + Math.floor(y * prec) + Math.floor(z * prec);

    if (!vertices.hasOwnProperty(id)) {
      vertices[id] = oldVertexIndexByNewIndex.length;

      positions.push(x, y, z);
      // access like this
      // positions[vertices[id] * 3] = x;
      // positions[vertices[id] * 3 + 1] = y;
      // positions[vertices[id] * 3 + 2] = z;

      oldVertexIndexByNewIndex.push(v);
    }

    return vertices[id];
  }

  return function buildIndexedPositions(geometry, precision) {
    prec = Math.pow(10, precision || 4);

    const positionsAttr = [];

    const position = geometry.attributes.position.array;

    const faceCount = position.length / 3 / 3;

    const largeIndexes = faceCount * 3 > 65536;
    const indexBuffer = new SharedArrayBuffer(
      faceCount * 3 * (largeIndexes ? 4 : 2)
    );
    const UIntConstructor = largeIndexes ? Uint32Array : Uint16Array;
    const indexArray = new UIntConstructor(indexBuffer);

    for (let i = 0, l = faceCount; i < l; i++) {
      const offset = i * 9;
      indexArray[i * 3] = store(
        position[offset],
        position[offset + 1],
        position[offset + 2],
        i * 3,
        positionsAttr
      );
      indexArray[i * 3 + 1] = store(
        position[offset + 3],
        position[offset + 4],
        position[offset + 5],
        i * 3 + 1,
        positionsAttr
      );
      indexArray[i * 3 + 2] = store(
        position[offset + 6],
        position[offset + 7],
        position[offset + 8],
        i * 3 + 2,
        positionsAttr
      );
    }
    vertices = {};
    oldVertexIndexByNewIndex.length = 0;

    const sab = new SharedArrayBuffer(positionsAttr.length * 4);
    const posArr = new Float32Array(sab);
    posArr.set(positionsAttr);

    return {
      index: indexArray,
      positions: posArr
    };
  };
})();

//
// below sources and experiments
//

export function loadBufferGeometry(
  geometry,
  newPositions,
  targetFaces,
  targetUVs
) {
  var attributes = geometry.attributes;
  var verticesMap = {}; // Hashmap for looking up vertices by position coordinates (and making sure they are unique)
  var changes = [];

  var key,
    vA,
    vAX,
    vAY,
    vAZ,
    vANewIndex,
    vB,
    vBX,
    vBY,
    vBZ,
    vBNewIndex,
    vC,
    vCX,
    vCY,
    vCZ,
    vCNewIndex;
  var precisionPoints = 4; // number of decimal points, e.g. 4 for epsilon of 0.0001
  var precision = Math.pow(10, precisionPoints);
  var i, il, face;
  var indices, j, jl;
  var oldToNewFaceMap = new Float32Array();

  var uniquePositions = 0;

  var faceId = 0;

  for (i = 0, il = attributes.position.count / 3; i < il; i++) {
    vA = getVertexIdByFaceIdFromPositions(i, 0);
    vAX = attributes.position.array[vA];
    vAY = attributes.position.array[vA + 1];
    vAZ = attributes.position.array[vA + 2];
    vANewIndex = vertexToMap(vA, vAX, vAY, vAZ);

    vB = getVertexIdByFaceIdFromPositions(i, 1);
    vBX = attributes.position.array[vB];
    vBY = attributes.position.array[vB + 1];
    vBZ = attributes.position.array[vB + 2];
    vBNewIndex = vertexToMap(vB, vBX, vBY, vBZ);

    vC = getVertexIdByFaceIdFromPositions(i, 2);
    vCX = attributes.position.array[vC];
    vCY = attributes.position.array[vC + 1];
    vCZ = attributes.position.array[vC + 2];
    vCNewIndex = vertexToMap(vC, vCX, vCY, vCZ);

    // check if face is not fucked
    if (
      vANewIndex === vBNewIndex ||
      vBNewIndex === vCNewIndex ||
      vCNewIndex === vANewIndex
    ) {
      // remove incorrect faceVertexUV
      // for (j = 0, jl = this.faceVertexUvs.length; j < jl; j++) {
      //   this.faceVertexUvs[j].splice(idx, 1);
      // }
      continue;
    }

    targetFaces[faceId] = vANewIndex;
    targetFaces[faceId + 1] = vBNewIndex;
    targetFaces[faceId + 2] = vCNewIndex;
    oldToNewFaceMap[i] = faceId;
    faceId++;
  }

  function getVertexIdByFaceIdFromPositions(faceId, vertexIndex) {
    return faceId * 9 + vertexIndex * 3;
  }

  function vertexToMap(oldVIndex, x, y, z) {
    key =
      Math.round(x * precision) +
      "_" +
      Math.round(y * precision) +
      "_" +
      Math.round(z * precision);

    if (verticesMap[key] === undefined) {
      verticesMap[key] = oldVIndex;

      newPositions[uniquePositions * 3] = x;
      newPositions[uniquePositions * 3 + 1] = y;
      newPositions[uniquePositions * 3 + 2] = z;

      // changes[oldVIndex] old vertex id mapped to new vertex id
      changes[oldVIndex] = uniquePositions;

      uniquePositions++;
    } else {
      //console.log('Duplicate vertex found. ', i, ' could be using ', verticesMap[key]);
      changes[oldVIndex] = changes[verticesMap[key]]; // if new address already exists pick out up from verticesMap
    }
  }
}

//
// TO INDEXED
//

export const toIndexed = (function() {
  let prec = 0;
  let oldVertexIndexByNewIndex = [];
  let vertices = {};

  function store(x, y, z, v) {
    const id =
      Math.floor(x * prec) +
      "_" +
      Math.floor(y * prec) +
      "_" +
      Math.floor(z * prec);

    if (vertices[id] === undefined) {
      vertices[id] = oldVertexIndexByNewIndex.length;

      oldVertexIndexByNewIndex.push(v);
    }

    return vertices[id];
  }

  function indexBufferGeometry(src, dst) {
    const positionsAttr = new Float32Array(src.attributes.position.count * 3);

    const position = src.attributes.position.array;

    const faceCount = position.length / 3 / 3;

    const type = faceCount * 3 > 65536 ? Uint32Array : Uint16Array;

    const indexArray = new type(faceCount * 3);

    const groupEnds = src.groups.map(el => el.start + el.count);

    for (let i = 0, l = faceCount; i < l; i++) {
      const offset = i * 9;

      // saving a face here - remapping to other vertex happens here

      indexArray[i * 3] = store(
        position[offset],
        position[offset + 1],
        position[offset + 2],
        i * 3
      );
      indexArray[i * 3 + 1] = store(
        position[offset + 3],
        position[offset + 4],
        position[offset + 5],
        i * 3 + 1
      );
      indexArray[i * 3 + 2] = store(
        position[offset + 6],
        position[offset + 7],
        position[offset + 8],
        i * 3 + 2
      );

      // if (groupEnds.includes) {

      // }

      // oldToNewFaceMap[i] = faceId;
    }

    dst.setIndex(new BufferAttribute(indexArray, 1));

    const count = oldVertexIndexByNewIndex.length;

    for (let key in src.attributes) {
      const src_attribute = src.attributes[key];
      const dst_attribute = new BufferAttribute(
        new src_attribute.array.constructor(count * src_attribute.itemSize),
        src_attribute.itemSize
      );

      const dst_array = dst_attribute.array;
      const src_array = src_attribute.array;

      switch (src_attribute.itemSize) {
        case 1:
          for (let i = 0, l = oldVertexIndexByNewIndex.length; i < l; i++) {
            dst_array[i] = src_array[oldVertexIndexByNewIndex[i]];
          }

          break;
        case 2:
          for (let i = 0, l = oldVertexIndexByNewIndex.length; i < l; i++) {
            const index = oldVertexIndexByNewIndex[i] * 2;

            const offset = i * 2;

            dst_array[offset] = src_array[index];
            dst_array[offset + 1] = src_array[index + 1];
          }

          break;
        case 3:
          for (let i = 0, l = oldVertexIndexByNewIndex.length; i < l; i++) {
            const index = oldVertexIndexByNewIndex[i] * 3;

            const offset = i * 3;

            dst_array[offset] = src_array[index];
            dst_array[offset + 1] = src_array[index + 1];
            dst_array[offset + 2] = src_array[index + 2];
          }

          break;
        case 4:
          for (let i = 0, l = oldVertexIndexByNewIndex.length; i < l; i++) {
            const index = oldVertexIndexByNewIndex[i] * 4;

            const offset = i * 4;

            dst_array[offset] = src_array[index];
            dst_array[offset + 1] = src_array[index + 1];
            dst_array[offset + 2] = src_array[index + 2];
            dst_array[offset + 3] = src_array[index + 3];
          }

          break;
      }

      dst.attributes[key] = dst_attribute;
    }

    dst.computeBoundingSphere();

    dst.computeBoundingBox();

    src.groups.forEach(group => {
      dst.addGroup(group.start, group.count, group.materialIndex);
    });

    // debugger;
    // Release data

    vertices = {};
    oldVertexIndexByNewIndex = [];
  }

  return function(precision) {
    prec = Math.pow(10, precision || 6);

    const geometry = new BufferGeometry();

    indexBufferGeometry(this, geometry);

    return geometry;
  };
})();
