import { Client } from 'pg';

import { BBox, FeatureCollection } from 'geojson';
import wkx, { Point } from 'wkx';

import express from 'express';
import bodyParser from 'body-parser';
import { xz_order_response } from './response';

const app = express();
app.use(bodyParser.json());
app.use(express.static('dist'));

interface Box{
    xmin : number;
    xmax : number;
    ymin: number;
    ymax: number;
}

function bbox(points : wkx.Point[]) {
    const box : Box = {
        xmin: Number.MAX_VALUE,
        ymin: Number.MAX_VALUE,
        xmax: -Number.MAX_VALUE,
        ymax: -Number.MAX_VALUE
    };

    for (const point of points) {
        if (point.x < box.xmin) box.xmin = point.x;
        if (point.x > box.xmax) box.xmax = point.x;
        if (point.y < box.ymin) box.ymin = point.y;
        if (point.y > box.ymin) box.ymax = point.y;
    }

    return box;
}

function normalize_bbox(box : Box) {
    return {
        xmin: box.xmin / 180,
        xmax: box.xmax / 180,
        ymin: box.ymin / 90,
        ymax: box.ymax / 90,
    }
}

function xz_index(box_:Box) {
    // Map point to [-1, 1] range
    const box = normalize_bbox(box_);
    const cell: Box = {
        xmin: -1, xmax:1, ymin:-1, ymax:1
    }

    // +---+---+
    // | 2 | 3 |
    // +---+---+
    // | 0 | 1 |
    // +---+---+
    let sequence = ""
    for (let i=0; i < 20; ++i) {
        const xmid = (cell.xmax + cell.xmin)/2;
        const ymid = (cell.ymax + cell.ymin)/2;
        let sub_cell;
        if (box.xmin <= xmid) {
            cell.xmax = xmid;
            if(box.ymin <= ymid) {
                sub_cell = "0"
                cell.ymax = ymid;
            } else {
                sub_cell = "2"
                cell.ymin = ymid;
            }
        } else {
            cell.xmin = xmid;
            if(box.ymin <= ymid) {
                sub_cell = "1"
                cell.ymax = ymid;
            } else {
                sub_cell = "3"
                cell.ymin = ymid;
            }
        }
        // Did the dwarfs of Moria dig to deep?
        const width = 2 * (cell.xmax - cell.xmin); 
        const height = 2 * (cell.ymax - cell.ymin);
        if (cell.xmin+width < box.xmax || cell.ymin+height < box.ymax) {
            break;
        }

        sequence += sub_cell;
    }
    return sequence;
}

function xzindex(geometry : wkx.Geometry) {
    if (geometry instanceof wkx.Point) {
        return xz_index(bbox([geometry]));
    } else if (geometry instanceof wkx.Polygon) {
        return xz_index(bbox(geometry.exteriorRing));
    }
    return "";
}

// Check if cell is completely inside box
function fully_inside(cell : Box, box: Box) {
    const xmax = cell.xmax + (cell.xmax - cell.xmin);
    const ymax = cell.ymax + (cell.ymax - cell.ymin);
    return box.xmin <= cell.xmin && box.xmax >= xmax && box.ymin <= cell.ymin && box.ymax >= ymax;
}

// Check if cell overlaps box
function overlaps(cell : Box, box: Box) {
    const xmax = cell.xmax + (cell.xmax - cell.xmin);
    const ymax = cell.ymax + (cell.ymax - cell.ymin);
    if (cell.xmin >= box.xmax) {
        // right
        return false;
    }
    if (xmax <= box.xmin) {
        // left
        return false;
    }
    if (cell.ymin >= box.ymax) {
        // top
        return false;
    }
    if (ymax <= box.ymin) {
        // bottom
        return false;
    }

    return true;
}


interface Cell {
    box : Box;
    sequence : string;
}

interface Range {
    start:string;
    end: string;
}

function sequence_ranges(box : Box) {
    const window = normalize_bbox(box);
    const startCell : Cell = {
        box : {
            xmin: -1, xmax:1, ymin:-1, ymax:1
        },
        sequence : ""
    }
    const cells = [ startCell ];
    
    const sequence_ranges : Array<Range> = []
    while(cells.length > 0) {
        const cell = cells.shift()!;
        if (fully_inside(cell.box, window)) {
            sequence_ranges.push({start:cell.sequence, end: cell.sequence + '*'});
        } else if (overlaps(cell.box, window)){
            sequence_ranges.push({start:cell.sequence, end: cell.sequence});
            const xmid = (cell.box.xmax + cell.box.xmin)/2;
            const ymid = (cell.box.ymax + cell.box.ymin)/2;
   
            if (cell.sequence.length < 20) {
                // +---+---+
                // | 2 | 3 |
                // +---+---+
                // | 0 | 1 |
                // +---+---+
                cells.push({
                    box: {
                        xmin: cell.box.xmin,
                        xmax: xmid,
                        ymin: cell.box.ymin,
                        ymax: ymid
                    },
                    sequence: cell.sequence + "0"
                },
                {
                    box: {
                        xmin: xmid,
                        xmax: cell.box.xmax,
                        ymin: cell.box.ymin,
                        ymax: ymid
                    },
                    sequence: cell.sequence + "1"
                },
                {
                    box: {
                        xmin: cell.box.xmin,
                        xmax: xmid,
                        ymin: ymid,
                        ymax: cell.box.ymax,
                    },
                    sequence: cell.sequence + "2"
                },
                {
                    box: {
                        xmin: xmid,
                        xmax: cell.box.xmax,
                        ymin: ymid,
                        ymax: cell.box.ymax,
                    },
                    sequence: cell.sequence + "3"
                });
            }
        }
    }
    return sequence_ranges;
}

app.post('/xz-order', async (req, response) => {
    //TODO: Validation
    const geojson = req.body as FeatureCollection;
    if (geojson.features.length < 1) {
        response.status(400).send('Geojson needs to contain a feature.');
        return;
    }

    const features = [];
    for (const feature of geojson.features) {
        const geometry = wkx.Geometry.parseGeoJSON(feature.geometry);
        features.push({
            id: feature.id,
            sequence: xzindex(geometry)
        });
    }

    response.send(JSON.stringify({features}));
});

app.post('/xz-range', async (req, response) => {
    //TODO: Validation
    const geojson = req.body as FeatureCollection;
    if (geojson.features.length < 1) {
        response.status(400).send('Geojson needs to contain a feature.');
        return;
    }

    const result : xz_order_response = {features: []};
    for (const feature of geojson.features) {
        const geometry = wkx.Geometry.parseGeoJSON(feature.geometry);
        if (geometry instanceof wkx.Polygon) {
            const ranges = sequence_ranges(bbox(geometry.exteriorRing));
            result.features.push({
                id: (feature.id as string) ?? crypto.randomUUID(),
                ranges
            });
        }
    }

    response.send(JSON.stringify(result));
});

app.listen(3000, () => {
    console.log('The application is listening on port 3000!');
});

