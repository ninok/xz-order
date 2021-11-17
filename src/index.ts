import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import * as L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';

import {FeatureCollection} from  'geojson';

import CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
// import 'codemirror/addon/display/fullscreen.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/mode/javascript/javascript.js';
// import 'codemirror/addon/display/fullscreen.js';

const textArea: HTMLTextAreaElement = document.getElementById('editor') as HTMLTextAreaElement;

const config: CodeMirror.EditorConfiguration = {
    tabSize: 4,
    lineNumbers: true,
    mode: 'javascript',
    theme: 'dracula',
    lineWrapping: true,
};

const editor = CodeMirror(textArea, config);
// editor.getWrapperElement().style.height="100%";

// Following requires are needed so that webpack file-loader copies those files to `dist`.
const iconRetinaUrl = require('leaflet/dist/images/marker-icon-2x.png');
const iconUrl = require('leaflet/dist/images/marker-icon.png');
const shadowUrl = require('leaflet/dist/images/marker-shadow.png');

const map = L.map('map');

const defaultCenter : L.LatLngTuple = [52.520008, 13.404954];
const defaultZoom = 15;
map.setView(defaultCenter, defaultZoom);

const basemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
});
basemap.addTo(map);

// const marker = L.marker(defaultCenter);
// marker.addTo(map);

const changeHandler = (instance: CodeMirror.Editor, change : CodeMirror.EditorChange) => {
  console.log('change');
  
  //FIXME: Error handling and validation
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;

  // Clear map first
  map.eachLayer((layer)=> {
    if(layer!==basemap) {
      map.removeLayer(layer);
    }
  });

  // Add each feature as a separate layer
  geojson.features.forEach(feature => {
    L.geoJSON(feature).addTo(map);
  })
}

const computeButton = document.getElementById("compute") as HTMLButtonElement;
const operationSelect = document.getElementById("operation") as HTMLSelectElement;
const resultTextArea = document.getElementById("result") as HTMLTextAreaElement;


const computeHandler = () => {
  // Clear map first, especially previous results
  map.eachLayer((layer)=> {
    if(layer!==basemap) {
      map.removeLayer(layer);
    }
  });

  //TODO: Error handling and validation
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;

  // Add the editor input again.
  geojson.features.forEach(feature => {
    L.geoJSON(feature).addTo(map);
  })

  const operation = operationSelect.selectedOptions[0].text;

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
    const geoJson = json as FeatureCollection;
    // Mark the features that are coming from the REST API to be able to filter them out later.
    for(const feature of geoJson.features) {
      if (!feature.properties) {
        feature.properties = {
          isResult: true
        }
      } else {
        feature.properties["isResult"] = true;
      }
    }
    const union = L.geoJSON(json);
    union.setStyle({ color: 'red' }).addTo(map);
    resultTextArea.value = JSON.stringify(json, undefined, 4);
  })
}

computeButton.addEventListener('click', computeHandler);



editor.on('change', changeHandler);

// add Leaflet-Geoman controls with some options to the map  
map.pm.addControls({
  position: 'topleft',
  drawCircle: false,
});

map.on('pm:drawstart', (e) => {
  console.log('pm:drawstart');
  const layer = e.workingLayer;
  layer.on('pm:update', (e) => {
    console.log('pm:update');
  });
  
  layer.on('pm:disable', (e) => {
    console.log('pm:disable');
  });
  
  layer.on('pm:edit', (e) => {
    console.log('pm:edit');
  });
});

map.on('pm:drawend', (e) => {
  console.log('pm:drawend');
  const geoJson = (map.pm.getGeomanLayers(true) as L.FeatureGroup).toGeoJSON() as FeatureCollection;

  geoJson.features = geoJson.features.filter((feature)=> {
    return !(feature.properties?.isResult === true);
  });

  editor.off('change', changeHandler);
  editor.setValue(JSON.stringify(geoJson, undefined, 4));
  editor.on('change', changeHandler);
});

