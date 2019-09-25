import { getArrayBuffer, calculateCRC, readRecord } from './binary';

export default class FitParser {
  constructor(options = {}) {
    this.options = {
      force: options.force != null ? options.force : true,
      speedUnit: options.speedUnit || 'm/s',
      lengthUnit: options.lengthUnit || 'm',
      temperatureUnit: options.temperatureUnit || 'celsius',
      elapsedRecordField: options.elapsedRecordField || false,
      mode: options.mode || 'list',
    };
  }

  parse(content, callback) {
    const blob = new Uint8Array(getArrayBuffer(content));

    if (blob.length < 12) {
      callback('File to small to be a FIT file', {});
      if (!this.options.force) {
        return;
      }
    }

    const headerLength = blob[0];
    if (headerLength !== 14 && headerLength !== 12) {
      callback('Incorrect header size', {});
      if (!this.options.force) {
        return;
      }
    }

    let fileTypeString = '';
    for (let i = 8; i < 12; i++) {
      fileTypeString += String.fromCharCode(blob[i]);
    }
    if (fileTypeString !== '.FIT') {
      callback('Missing \'.FIT\' in header', {});
      if (!this.options.force) {
        return;
      }
    }

    if (headerLength === 14) {
      const crcHeader = blob[12] + (blob[13] << 8);
      const crcHeaderCalc = calculateCRC(blob, 0, 12);
      if (crcHeader !== crcHeaderCalc) {
        // callback('Header CRC mismatch', {});
        // TODO: fix Header CRC check
        if (!this.options.force) {
          return;
        }
      }
    }
    const dataLength = blob[4] + (blob[5] << 8) + (blob[6] << 16) + (blob[7] << 24);
    const crcStart = dataLength + headerLength;
    const crcFile = blob[crcStart] + (blob[crcStart + 1] << 8);
    const crcFileCalc = calculateCRC(blob, headerLength === 12 ? 0 : headerLength, crcStart);

    if (crcFile !== crcFileCalc) {
      // callback('File CRC mismatch', {});
      // TODO: fix File CRC check
      if (!this.options.force) {
        return;
      }
    }

    const fitObj = {};
    const sessions = [];
    const laps = [];
    const records = [];
    const events = [];
    const hrv = [];
    const devices = [];
    const applications = [];
    const fieldDescriptions = [];
    const dive_gases = [];
    const course_points = [];

    let tempLaps = [];
    let tempRecords = [];

    let loopIndex = headerLength;
    const messageTypes = [];
    const developerFields = [];

    const isModeCascade = this.options.mode === 'cascade';
    const isCascadeNeeded = isModeCascade || this.options.mode === 'both';

    let startDate, lastStopTimestamp;
    let pausedTime = 0;

    while (loopIndex < crcStart) {
      const { nextIndex,
        messageType,
        message } = readRecord(blob, messageTypes, developerFields, loopIndex, this.options, startDate, pausedTime);
      loopIndex = nextIndex;

      switch (messageType) {
        case 'lap':
          if (isCascadeNeeded) {
            message.records = tempRecords;
            tempRecords = [];
            tempLaps.push(message);
          }
          laps.push(message);
          break;
        case 'session':
          if (isCascadeNeeded) {
            message.laps = tempLaps;
            tempLaps = [];
          }
          sessions.push(message);
          break;
        case 'event':
          if (message.event === 'timer') {
            if (message.event_type === 'stop_all') {
              lastStopTimestamp = message.timestamp;
            } else if (message.event_type === 'start' && lastStopTimestamp) {
              pausedTime += (message.timestamp - lastStopTimestamp) / 1000;
            }
          }
          events.push(message);
          break;
        case 'hrv':
          hrv.push(message);
          break;
        case 'record':
          if (!startDate) {
            startDate = message.timestamp;
            message.elapsed_time = 0;
            message.timer_time = 0;
          }
          records.push(message);
          if (isCascadeNeeded) {
            tempRecords.push(message);
          }
          break;
        case 'field_description':
          fieldDescriptions.push(message);
          break;
        case 'device_info':
          devices.push(message);
          break;
        case 'developer_data_id':
          applications.push(message);
          break;
        case 'dive_gas':
          dive_gases.push(message);
          break;
        case 'course_point':
          course_points.push(message);
          break;
        default:
          if (messageType !== '') {
            fitObj[messageType] = message;
          }
          break;
      }
    }

    if (isCascadeNeeded) {
      fitObj.activity = fitObj.activity || {};
      fitObj.activity.sessions = sessions;
      fitObj.activity.events = events;
      fitObj.activity.hrv = hrv;
    }
    if (!isModeCascade) {
      fitObj.sessions = sessions;
      fitObj.laps = laps;
      fitObj.records = records;
      fitObj.events = events;
      fitObj.device_infos = devices;
      fitObj.developer_data_ids = applications;
      fitObj.field_descriptions = fieldDescriptions;
      fitObj.hrv = hrv;
      fitObj.dive_gases = dive_gases;
      fitObj.course_points = course_points;
    }

    callback(null, fitObj);
  }
}
