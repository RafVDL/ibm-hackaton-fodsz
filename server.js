const express = require("express");
const app = express();
const bodyParser = require('body-parser');
const xml = require('xml-js');
const fs = require('fs');
const path = require('path');
const find = require('find');
const mongoose = require('mongoose');
const unirest = require('unirest');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// models
const Patient = require('./model/Patient.model');
const Click = require('./model/Click.model');

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(cors());

morgan.token('remote-addr', function (req, res) {
  var ffHeaderValue = req.headers['x-forwarded-for'];
  return ffHeaderValue || req.connection.remoteAddress;
});
app.use(morgan('short'));

mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true });

function generateRandomInteger(min, max) {
  return Math.floor(min + Math.random() * (max + 1 - min))
}

function getPatient(id, request, response) {
  if (!fs.existsSync(path.resolve('db/patient' + id))) {
    response.status(404).json({
      "error": "Patient not found"
    });
    console.log("Patient not found: " + id);
    return;
  }
  find.file(/\.xml$/, __dirname + "/db/patient" + id, function (files) {
    if (files.length == 0) {
      response.status(404).json({
        "error": "Patient information not found"
      });
      console.log("Patient information not found: " + id);
      return;
    }
    let xmlData = fs.readFileSync(files[0], 'utf8');
    let result = xml.xml2js(xmlData, { compact: true });
    let databaseResult = undefined;

    Patient.findOne({ patient_id: id }).populate('clicks').exec(function (err, dbResult) {
      if (err) {
        console.log("Error in looking up patient");
      } else if (!dbResult) {
        // patient not known in database
        let patient = new Patient({ patient_id: id });
        patient.save(function (err, dbResult) {
          if (err) {
            console.log("Failed to initialize person");
            console.log(err);
          }
        });
      } else {
        databaseResult = dbResult;
      }

      let occurrenceICD = xmlData.indexOf("S=\"ICD\"");
      let tagStart = occurrenceICD, tagEnd = occurrenceICD;
      do {
        --tagStart;
      } while (tagStart > 0 && xmlData.substring(tagStart, tagStart + 3) != '<cd')
      do {
        ++tagEnd;
      } while (tagEnd < xmlData.length && xmlData.substring(tagEnd - 5, tagEnd) != '</cd>')

      // do {
      //   --tagStart;
      // } while (tagStart > 0 && xmlData.substring(tagStart, tagStart + 6) != '<item>')
      // do {
      //   ++tagEnd;
      // } while (tagEnd < xmlData.length && xmlData.substring(tagEnd - 7, tagEnd) != '</item>')

      let tag = xml.xml2js(xmlData.substring(tagStart, tagEnd));
      let illness = tag.elements[0].attributes.DN;

      if (!illness)
        illness = tag.elements[0].elements[0].text;

      // get keywords for patient
      unirest.get(process.env.KNOWLEDGE_URL + "/getKeywords/" + id).header('Accept', 'javascript/json').end((dataResponse) => {
        let body = JSON.parse(dataResponse.body);
        let keywords = {};
        // random description
        for (let keyword of body.keywords) {
          let category = keyword.type;
          let value = undefined;
          switch (category) {
            case "Medicatie":
              value = keyword.text + ": " + generateRandomInteger(1, 20) + " mg";
              break;
            default:
              value = "Year " + generateRandomInteger(2000, 2018) + ": " + keyword.text
              break;
          }
          keywords[keyword.text] = [{
            "data_type": "text",
            "value": value
          }];
        }
        return response.json({
          "id": id,
          "patient_info": {
            "id": id,
            "first_name": result.kmehrmessage.folder.patient.firstname._text,
            "last_name": result.kmehrmessage.folder.patient.familyname._text,
            "birthdate": result.kmehrmessage.folder.patient.birthdate.date._text,
            "sex": result.kmehrmessage.folder.patient.sex.cd._text,
            "job": "retired"
          },
          "demand": "parking license",
          "pathologies": [
            illness
          ],
          "db": databaseResult,
          "keywords": keywords
        });
      });
    });
  });
}

const queue = [30, 9, 1, 3];
let index = 0, iId = 0;

let startRandomId = 9;

// get random patient
app.get('/api/patient', (request, response) => {
  let found = false;
  let id;

  do {
    if (index >= queue.length) {
      iId = startRandomId++;
      if (startRandomId > 31)
        iId = startRandomId = 1;
    } else {
      iId = queue[index++];
    }

    id = ("0" + iId++).slice(-2)
    found = fs.existsSync(path.resolve('db/patient' + id));
  } while (!found);

  if (!fs.existsSync(path.resolve('db/patient' + id))) {
    response.status(404).json({
      "error": "Patient not found"
    });
    console.log("Patient not found: " + id);
    return;
  }

  getPatient(id, request, response);
});

app.get("/api/patient/:id", (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  getPatient(id, request, response);
});

app.post('/api/patient/:id', (request, response) => {
  // TODO: get motivation from service
  let id = ("0" + request.params.id).slice(-2);
  console.log("Saving scores for patient " + request.params.id + " ( " + request.body.score.length + " categories)");
  let score = 0;
  for (let scoreI of request.body.score) {
    score += scoreI.score;
  }
  Patient.findOneAndUpdate({ patient_id: id }, { score: request.body.score }).populate('clicks').exec((err, result) => {
    if (err)
      return response.status(500).json({
        "error": "failed to save patient"
      })
    if (!result)
      return response.status(404).json({
        "error": "patient not found"
      })

    let keyword = undefined;

    if (result.clicks && result.clicks.length > 0)
      keyword = result.clicks[0].keyword

    if (!keyword) {
      return response.json({
        "message": "success",
        "predicted_motivation": [
          "No evidence has been investigated. Cannot provide motivation"
        ]
      });
    }

    // get keywords for patient
    unirest.get(process.env.KNOWLEDGE_URL + "/generateMotivation/" + keyword + "/" + score).header('Accept', 'javascript/json').end((dataResponse) => {
      let body = JSON.parse(dataResponse.body);
      return response.json({
        "message": "success",
        "predicted_motivation": [
          body.message
        ]
      });
    });
  });
});

app.post('/api/patient/:id/click', (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  if (!fs.existsSync(path.resolve('db/patient' + id))) {
    response.status(404).json({
      "error": "Patient not found"
    });
    console.log("Patient not found: " + request.params.id);
    return;
  }

  console.log("Captured click for patient " + id + ": " + request.body.keyword);

  Patient.findOne({ patient_id: id }).populate('clicks').exec(function (err, result) {
    if (err)
      return response.status(500).json({
        "error": "failed to add click"
      })
    if (!result)
      return response.status(405).json({
        "error": "non existent"
      })
    let click = new Click({ keyword: request.body.keyword });
    click.save(function (err, result2) {
      if (err)
        return response.status(500).json({
          "error": "failed to add click"
        })
      result.clicks.push(result2);
      result.save(function (err, result) {
        if (err)
          return response.status(500).json({
            "error": "failed to add click"
          })
        return response.json({
          "message": "success"
        })
      });
    });
  });
});

app.post('/api/patient/:id/done', (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  let data = {};
  data.status = request.body.status;
  if (request.body.status == "done") {
    data.motivation = request.body.motivation;
  }
  Patient.findOneAndUpdate({ patient_id: id }, data).exec(function (err, result) {
    if (err)
      return response.status(500).json({
        "error": "failed to add click"
      })
    if (!result)
      return response.status(405).json({
        "error": "non existent"
      })
    return response.json({
      "message": "success"
    });
  });
});

app.use(express.static('public'));

var port = process.env.PORT || 3000
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
  Click.deleteMany({}, (err, result) => {
    console.log("Deleted clicks");
  });
  Patient.deleteMany({}, (err, result) => {
    console.log("Deleted patients");
  });
  app.listen(port, function () {
    console.log("To view your app, open this link in your browser: http://localhost:" + port);
  });
});
