import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import * as L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';

import { Feature, FeatureCollection, GeoJsonObject, GeoJsonProperties, Geometry, Polygon } from 'geojson';

import CodeMirror from 'codemirror';
import { xz_order_response, xz_range, xz_ranges } from './response';

// Following imports are needed so that webpack injects them into index.html
import 'codemirror/lib/codemirror.css';
// import 'codemirror/addon/display/fullscreen.css';
// import 'codemirror/addon/display/fullscreen.js';
import 'codemirror/theme/dracula.css';
import 'codemirror/mode/javascript/javascript.js';
import './style.css'

// Following requires are needed so that webpack file-loader copies those files to `dist`.
const iconRetinaUrl = require('leaflet/dist/images/marker-icon-2x.png');
const iconUrl = require('leaflet/dist/images/marker-icon.png');
const shadowUrl = require('leaflet/dist/images/marker-shadow.png');

const textArea = document.getElementById('editor') as HTMLDivElement;

const config: CodeMirror.EditorConfiguration = {
  tabSize: 4,
  lineNumbers: true,
  mode: 'javascript',
  theme: 'dracula',
  lineWrapping: true,
};

const editor = CodeMirror(textArea, config);
// editor.getWrapperElement().style.height="100%";

const map = L.map('map');

const defaultCenter: L.LatLngTuple = [52.520008, 13.404954];
const defaultZoom = 15;
map.setView(defaultCenter, defaultZoom);

const basemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
});
basemap.addTo(map);

let inputLayer: L.LayerGroup;
let resultLayer: L.FeatureGroup | undefined;

// Map from feature id to sequence (for xz order)
// or sub-feature-id to range (for xz query)
let results : Map<string, string | xz_range> = new Map();

function clearResultLayer() {
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;
  map.eachLayer((layer) => {
    if (layer !== basemap) {
      map.removeLayer(layer);
    }
  });
  L.geoJSON(geojson).addTo(map);
}

const changeHandler = (instance: CodeMirror.Editor, change: CodeMirror.EditorChange) => {
  console.log('change');
  clearResultLayer();
}

const computeButton = document.getElementById("compute") as HTMLButtonElement;
const operationSelect = document.getElementById("operation") as HTMLSelectElement;
// const resultTextArea = document.getElementById("result") as HTMLTextAreaElement;
const resultSelectElement = document.getElementById('results') as HTMLSelectElement;

const operationColors = new Map([
  ['xz-order', 'red'],
  ['xz-range', 'yellow']
]);


function geometry_from_xz_sequence(sequence: string) : Feature<Geometry, GeoJsonProperties> {
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

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [xmin, ymin],
          [xmax, ymin],
          [xmax, ymax],
          [xmin, ymax],
          [xmin, ymin]
        ]
      ]
    }
  }

}

function renderSelectedResults() {
  clearResultLayer();
  const features: Array<Feature<Geometry, GeoJsonProperties>> = [];
  for(const child of resultSelectElement) {
    if(child.selected) {
      console.log(child.value);
      const sequence = results.get(child.value);
      if (!sequence) {
        continue;
      }
      if (typeof sequence == "string") {
        features.push(geometry_from_xz_sequence(sequence));
      } else {
        features.push(geometry_from_xz_sequence(sequence.start));
      }
    }
  }

  const geoJson : FeatureCollection = {
    type: 'FeatureCollection',
    features
  };
    resultLayer = L.geoJSON(geoJson);
    resultLayer.pm.setOptions({
      allowEditing: false,
      draggable: false
    })
    const color = 'red'; //operationColors.get(operation) ?? 'red';
    resultLayer.setStyle({ color }).addTo(map);
    resultLayer.bringToBack();
    for (const feature of geoJson.features) {
      if (feature.geometry.type == 'Polygon' && feature.properties?.sequence) {
        const point = feature.geometry.coordinates[0][0];
        const marker = L.marker([point[1], point[0]], {
          textMarker: true,
          text: feature.properties.sequence,
        }).addTo(resultLayer);
        marker.pm.setOptions({
          allowEditing: false,
          draggable: false
        });
        const element = marker.getElement()
        if (element)
          element.style.fontSize = '6px';
      }
    }

}

resultSelectElement.addEventListener('change', (ev) => {
  if(ev.target == resultSelectElement) {
    renderSelectedResults()
  }
});

const computeHandler = () => {
  // Clear map first, especially previous results
  map.eachLayer((layer) => {
    if (layer !== basemap) {
      map.removeLayer(layer);
    }
  });

  //TODO: Error handling and validation
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;
  for (const feature of geojson.features) {
    if(!feature.id) {
      feature.id = self.crypto.randomUUID();
    }
  }

  editor.off('change', changeHandler);
  editor.setValue(JSON.stringify(geojson, undefined, 4));
  editor.on('change', changeHandler);

  // Add the editor input again.
  inputLayer = L.geoJSON(geojson).addTo(map);

  const operation = operationSelect.selectedOptions[0].value;

  console.log(`Computing ${operation}`);
  fetch(
    operation,
    {
      method: 'POST',
      body: JSON.stringify(geojson),
      headers: {
        'Content-Type': 'application/json'
      },
    }
  ).then(value => value.json()).then(json => {
    console.log(json);
    //TODO: verification
    const response = json as xz_order_response;

    while (resultSelectElement.lastElementChild) {
      resultSelectElement.removeChild(resultSelectElement.lastElementChild);
    }
    results.clear();
    for (const feature of response.features) {
      if (feature.sequence) {
        const option = document.createElement("option");
        option.value = feature.id
        option.innerHTML = feature.sequence;
        resultSelectElement.appendChild(option);  

        results.set(feature.id, feature.sequence);
      } else if (feature.ranges) {
        let i = 0;
        const optionSeparator = document.createElement("option");
        optionSeparator.value = ''
        optionSeparator.innerHTML = '---------------------------'
        optionSeparator.disabled = true
        resultSelectElement.appendChild(optionSeparator);  
        for(const range of feature.ranges) {
          const sub_id = feature.id + ':' + i;
          const option = document.createElement("option");
          option.value = sub_id;
          option.innerHTML = range.start + ' - ' + range.end
          resultSelectElement.appendChild(option);

          results.set(sub_id, range);
          ++i;
        }
      }
    }
  }).catch(reason => {
    // TODO: Set error message
    if (resultLayer) {
      map.removeLayer(resultLayer);
      resultLayer = undefined;
    }
  })
}

function updateTextEditor() {
  if (resultLayer) {
    map.removeLayer(resultLayer);
  }

  const geoJson = map.pm.getGeomanLayers(true).toGeoJSON() as FeatureCollection;

  if (resultLayer) {
    map.addLayer(resultLayer);
  }

  editor.off('change', changeHandler);
  editor.setValue(JSON.stringify(geoJson, undefined, 4));
  editor.on('change', changeHandler);
}

computeButton.addEventListener('click', computeHandler);

editor.on('change', changeHandler);

// add Leaflet-Geoman controls with some options to the map  
map.pm.addControls({
  position: 'topleft',
  drawCircle: false,
});

// Register events to keep editor and map in sync.
map.on('pm:globaleditmodetoggled', (e) => {
  console.log('pm:globaleditmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      // layer.on('pm:dragend', (e)=>{
      //   console.log('pm:dragend');
      // })
    } else {
      // There are so many events to listen to,
      // so for now we just update the editor when edit mode is toggled off again.
      // layer.off('pm:dragend');
      updateTextEditor();
    }
  })
});

map.on('pm:globaldragmodetoggled', (e) => {
  console.log('pm:globaldragmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      layer.on('pm:dragend', (e) => {
        console.log('pm:dragend');
        updateTextEditor();
      })
    } else {
      layer.off('pm:dragend');
    }
  })
});

map.on('pm:globalremovalmodetoggled', (e) => {
  console.log('pm:globaldragmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      layer.on('pm:remove', (e) => {
        console.log('pm:remove');
        updateTextEditor();
      })
    } else {
      layer.off('pm:remove');
    }
  })
});

map.on('pm:drawend', (e) => {
  console.log('pm:drawend');
  updateTextEditor();
});

