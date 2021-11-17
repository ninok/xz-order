import { Client } from 'pg';

import { FeatureCollection } from 'geojson';
import wkx, { Point } from 'wkx';

import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());
app.use(express.static('dist'));

function morton_code(x : number, y: number, level : number) {
    // Map point to [-1, 1] range
    x = x / 180
    y = y / 90

    // +---+---+
    // | 2 | 3 |
    // +---+---+
    // | 0 | 1 |
    // +---+---+
    let sequence = ""
    for (let i=0; i < level; ++i) {
        if (x <= 0 && y <= 0) {
            sequence += "0"
            x = x * 2 + 1;
            y = y * 2 + 1;
            continue;
        }
        if (x <= 0 && y > 0) {
            sequence += "2"
            x = x * 2 + 1;
            y = y * 2 - 1;
            continue;
        }
        if (x > 0 && y <= 0) {
            sequence += "1"
            x = x * 2 - 1;
            y = y * 2 + 1;
            continue;
        }
        if (x > 0 && y > 0) {
            sequence += "3"
            x = x * 2 - 1;
            y = y * 2 - 1;
            continue;
        }
    }
    return sequence;
}


function xzindex(geometry : wkx.Geometry) {
    if (geometry instanceof wkx.Point) {
        return morton_code(geometry.x, geometry.y, 15);
    } else if (geometry instanceof wkx.Polygon) {
        let xmin = Number.MAX_VALUE;
        let ymin = Number.MAX_VALUE;
        let xmax = -Number.MAX_VALUE;
        let ymax = -Number.MAX_VALUE;

        for (const point of geometry.exteriorRing) {
            if (point.x < xmin) xmin = point.x;
            if (point.x > xmax) xmax = point.x;
            if (point.y < ymin) ymin = point.y;
            if (point.y > ymin) ymax = point.y;
        }

        const max_d = Math.max( Math.abs(xmax-xmin)/180, Math.abs(ymax-ymin)/90);
        const l1 = Math.floor(Math.log(max_d) / Math.log(0.5));

        return morton_code(xmin, ymin, l1);
    }
    return "";
}

function geometry_from_xzindex(sequence: string) {
    let xmin = -1.0;
    let ymin = -1.0;
    let xmax = 1.0;
    let ymax = 1.0;

    // +---+---+
    // | 2 | 3 |
    // +---+---+
    // | 0 | 1 |
    // +---+---+
    for (let i = 0; i < sequence.length; ++i) {
        switch (sequence[i]) {
            case '0':
                xmax = (xmin + xmax) / 2;
                ymax = (ymin + ymax) / 2;
                break;
            case '1':
                xmin = (xmin + xmax) / 2;
                ymax = (ymin + ymax) / 2;
                break;
            case '2':
                xmax = (xmin + xmax) / 2;
                ymin = (ymin + ymax) / 2;
                break;
            case '3':
                xmin = (xmin + xmax) / 2;
                ymin = (ymin + ymax) / 2;
                break;
        }
    }

    // Finally double the extent:
    xmax += xmax - xmin;
    ymax += ymax - ymin;

    xmin = xmin * 180;
    xmax = xmax * 180;
    ymin = ymin * 90;
    ymax = ymax * 90;

    return new wkx.Polygon([
        new Point(xmin, ymin),
        new Point(xmax, ymin),
        new Point(xmax, ymax),
        new Point(xmin, ymax),
        new Point(xmin, ymin),
    ]);
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
        const sequence = xzindex(geometry);
        const border_geom = geometry_from_xzindex(sequence);
        features.push(
        {
            "type": "Feature",
            "properties": {},
            "geometry": border_geom.toGeoJSON()
        });
    }

    response.send(JSON.stringify({
        type: "FeatureCollection",
        features
    }));

});

app.listen(3000, () => {
    console.log('The application is listening on port 3000!');
});

