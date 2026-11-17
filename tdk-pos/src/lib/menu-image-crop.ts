export type CropArea = { x: number; y: number; width: number; height: number };
export type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function initialMenuImageCrop(width: number, height: number, aspectRatio: number | null): CropArea {
  if (aspectRatio !== null) {
    const cropWidth = Math.min(width * 0.82, height * 0.82 * aspectRatio);
    const cropHeight = cropWidth / aspectRatio;
    return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
  }
  const cropWidth = width * 0.82;
  const cropHeight = height * 0.82;
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export function moveMenuImageCrop(start: CropArea, dx: number, dy: number, imageWidth: number, imageHeight: number): CropArea {
  return {
    ...start,
    x: clamp(start.x + dx, 0, imageWidth - start.width),
    y: clamp(start.y + dy, 0, imageHeight - start.height),
  };
}

export function adjustMenuImageCrop(start: CropArea, handle: CropHandle, dx: number, dy: number, imageWidth: number, imageHeight: number, aspectRatio: number | null, minWidth: number, minHeight: number): CropArea {
  const left = handle.includes("w"); const right = handle.includes("e");
  const top = handle.includes("n"); const bottom = handle.includes("s");
  let next = { ...start };

  if (aspectRatio === 1) {
    const centerX = start.x + start.width / 2;
    const centerY = start.y + start.height / 2;
    const horizontalAnchor = left ? start.x + start.width : start.x;
    const verticalAnchor = top ? start.y + start.height : start.y;
    let maxSide = start.width;
    let proposed = start.width;
    let x: number;
    let y: number;

    if (left || right) {
      maxSide = Math.min(
        left ? horizontalAnchor : imageWidth - horizontalAnchor,
        2 * Math.min(centerY, imageHeight - centerY),
      );
      if (top || bottom) {
        const signedDx = dx * (right ? 1 : -1);
        const signedDy = dy * (bottom ? 1 : -1);
        proposed += (signedDx + signedDy) / 2;
        x = left ? horizontalAnchor - maxSide : horizontalAnchor;
        y = top ? verticalAnchor - maxSide : verticalAnchor;
      } else {
        proposed += dx * (right ? 1 : -1);
        x = left ? horizontalAnchor - maxSide : horizontalAnchor;
        y = centerY - maxSide / 2;
      }
    } else {
      maxSide = Math.min(
        2 * Math.min(centerX, imageWidth - centerX),
        top ? verticalAnchor : imageHeight - verticalAnchor,
      );
      proposed += dy * (bottom ? 1 : -1);
      x = centerX - maxSide / 2;
      y = top ? verticalAnchor - maxSide : verticalAnchor;
    }

    const minSide = Math.min(Math.max(1, Math.min(minWidth, minHeight)), maxSide);
    const side = clamp(proposed, minSide, maxSide);
    if (left || right) {
      x = left ? horizontalAnchor - side : horizontalAnchor;
      y = top ? verticalAnchor - side : bottom ? verticalAnchor : centerY - side / 2;
    } else {
      x = centerX - side / 2;
      y = top ? verticalAnchor - side : verticalAnchor;
    }
    next = { x, y, width: side, height: side };
  } else if (aspectRatio !== null) {
    const centerX = start.x + start.width / 2;
    const centerY = start.y + start.height / 2;
    const horizontal = left || right;
    const vertical = top || bottom;
    const anchorX = horizontal ? (left ? start.x + start.width : start.x) : centerX;
    const anchorY = vertical ? (top ? start.y + start.height : start.y) : centerY;
    const maxWidth = Math.min(
      horizontal ? (left ? anchorX : imageWidth - anchorX) : 2 * Math.min(centerX, imageWidth - centerX),
      (vertical ? (top ? anchorY : imageHeight - anchorY) : 2 * Math.min(centerY, imageHeight - centerY)) * aspectRatio,
    );
    const signedDx = horizontal ? dx * (right ? 1 : -1) : 0;
    const signedDy = vertical ? dy * (bottom ? 1 : -1) * aspectRatio : 0;
    const minimumWidth = Math.min(Math.max(minWidth, minHeight * aspectRatio), maxWidth);
    const width = clamp(start.width + (signedDx + signedDy) / (horizontal && vertical ? 2 : 1), minimumWidth, maxWidth);
    const height = width / aspectRatio;
    const x = horizontal ? (left ? anchorX - width : anchorX) : centerX - width / 2;
    const y = vertical ? (top ? anchorY - height : anchorY) : centerY - height / 2;
    return { x, y, width, height };
  } else {
    if (left || right) {
      const anchor = left ? start.x + start.width : start.x;
      const maxWidth = left ? anchor : imageWidth - start.x;
      const width = clamp(start.width + (right ? dx : -dx), Math.min(minWidth, maxWidth), maxWidth);
      next.x = left ? anchor - width : start.x;
      next.width = width;
    }
    if (top || bottom) {
      const anchor = top ? start.y + start.height : start.y;
      const maxHeight = top ? anchor : imageHeight - start.y;
      const height = clamp(start.height + (bottom ? dy : -dy), Math.min(minHeight, maxHeight), maxHeight);
      next.y = top ? anchor - height : start.y;
      next.height = height;
    }
  }

  next.width = clamp(next.width, Math.min(minWidth, imageWidth), imageWidth);
  next.height = clamp(next.height, Math.min(minHeight, imageHeight), imageHeight);
  next.x = clamp(next.x, 0, imageWidth - next.width);
  next.y = clamp(next.y, 0, imageHeight - next.height);
  return next;
}
